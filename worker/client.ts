import { api } from "convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { WorkerHeartbeatInterval } from "shared/config";
import { chatCompletion, LLM_CONFIG } from "shared/llm";

// You can add / remove whatever models you want to use here.
export const completionModels = [
  "llama3",
  "codegemma",
  "codellama:7b",
  "llama2",
  "mistral",
] as const;
export type CompletionModels = (typeof completionModels)[number];

function waitForWork(client: ConvexClient) {
  return new Promise<void>((resolve, reject) => {
    const unsubscribe = client.onUpdate(
      api.workers.isThereWork,
      {},
      async (isWork) => {
        if (isWork) {
          resolve();
          unsubscribe();
        }
      },
      reject
    );
  });
}

async function doWork(client: ConvexClient, apiKey: string) {
  const work = await client.mutation(api.workers.giveMeWork, { apiKey });
  if (!work) {
    return;
  }
  const model = work.model ?? LLM_CONFIG.chatModel;
  console.debug(work);
  const { messages, jobId } = work;
  const timerId = setInterval(() => {
    console.debug("Still working...");
    client
      .mutation(api.workers.imStillWorking, { apiKey, jobId })
      .then(console.log)
      .catch(console.error);
  }, WorkerHeartbeatInterval);
  try {
    if (work.stream) {
      const { content: stream } = await chatCompletion({
        stream: true,
        model,
        messages,
      });
      let response = "";
      for await (const part of stream.read()) {
        response += part;
        // Some debouncing to avoid sending too many messages.
        if (hasDelimeter(response)) {
          await client.mutation(api.workers.submitWork, {
            message: response,
            state: "streaming",
            apiKey,
            jobId,
          });
          response = "";
        }
      }
      await client.mutation(api.workers.submitWork, {
        message: response,
        state: "success",
        apiKey,
        jobId,
      });
    } else {
      const { content } = await chatCompletion({
        stream: false,
        model,
        messages,
      });
      await client.mutation(api.workers.submitWork, {
        message: content,
        state: "success",
        apiKey,
        jobId,
      });
    }
  } catch (e) {
    await client.mutation(api.workers.submitWork, {
      message: e instanceof Error ? e.message : String(e),
      state: "failed",
      apiKey,
      jobId,
    });
  } finally {
    clearInterval(timerId);
  }
}

function hasDelimeter(response: string) {
  return (
    response.includes("\n") ||
    response.includes(".") ||
    response.includes("?") ||
    response.includes("!") ||
    response.includes(",") ||
    response.length > 100
  );
}

async function main() {
  const apiKey = process.env.WORKER_API_KEY;
  const convexUrl = process.env.VITE_CONVEX_URL;
  console.log(apiKey, convexUrl);
  if (!apiKey || !convexUrl) {
    throw new Error(
      "Missing environment variables WORKER_API_KEY or CONVEX_URL"
    );
  }
  const client = new ConvexClient(convexUrl);
  for (;;) {
    console.debug("Waiting for work...");
    await waitForWork(client);
    console.debug("Attempting work...");
    await doWork(client, apiKey);
  }
}
main().then(console.log).catch(console.error);
