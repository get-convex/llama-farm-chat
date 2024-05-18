import inquirer from "inquirer";
import dotenv from "dotenv";
import { ConvexClient } from "convex/browser";
import { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { WorkerHeartbeatInterval, completionModels } from "../shared/config";
import {
  chatCompletion,
  LLM_CONFIG,
  pullOllama,
  retryWithBackoff,
} from "../shared/llm";
import { appendFile } from "fs";
import { hasDelimeter } from "../shared/worker";
dotenv.config({ path: [".env", ".env.local"] });

function waitForWork(client: ConvexClient) {
  return new Promise<void>((resolve, reject) => {
    const unsubscribe = client.onUpdate(
      api.workers.isThereWork,
      {},
      (isWork) => {
        if (isWork) {
          resolve();
          unsubscribe();
        }
      },
      reject,
    );
  });
}

async function doWork(
  work: FunctionReturnType<typeof api.workers.giveMeWork>,
  client: ConvexClient,
  apiKey: string,
) {
  if (!work) {
    return null;
  }
  const model = work.model ?? LLM_CONFIG.chatModel;
  if (!completionModels.find((m) => m === model)) {
    await client.mutation(api.workers.submitWork, {
      message: `Invalid model: ${model}`,
      state: "failed",
      apiKey,
      jobId: work.jobId,
    });
  }
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
    const { retries, result } = await retryWithBackoff(async () => {
      if (work.stream) {
        const { content: stream } = await chatCompletion({
          stream: true,
          model,
          messages,
        });
        let totalLength = 0;
        let response = "";
        for await (const part of stream.read()) {
          response += part;
          // Some debouncing to avoid sending too many messages.
          if (hasDelimeter(response)) {
            console.debug("part:", response);
            totalLength += response.length;
            await client.mutation(api.workers.submitWork, {
              message: response,
              state: "streaming",
              apiKey,
              jobId,
            });
            response = "";
          }
        }
        if (response) console.debug("part:", response);
        if (!response && totalLength === 0)
          throw { error: "No response", retry: true };
        console.debug("Finished streaming");
        return client.mutation(api.workers.submitWork, {
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
        console.debug("Response:", content);
        if (!content) throw { error: "No response", retry: true };
        return client.mutation(api.workers.submitWork, {
          message: content,
          state: "success",
          apiKey,
          jobId,
        });
      }
    });
    if (retries > 0) console.warn("Retried", retries, "times");
    return result;
  } catch (e) {
    console.error(e);
    return client.mutation(api.workers.submitWork, {
      message: e instanceof Error ? e.message : String(e),
      state: "failed",
      apiKey,
      jobId,
    });
  } finally {
    clearInterval(timerId);
  }
}

async function main() {
  const key = process.env.WORKER_API_KEY || undefined;
  const url = process.env.VITE_CONVEX_URL || undefined;
  const answers = await inquirer.prompt(
    [
      {
        type: "input",
        name: "convexUrl",
        message: ".convex.cloud URL?",
      },
      {
        type: "input",
        name: "apiKey",
        message: "Worker API key?",
      },
    ],
    { apiKey: key, convexUrl: url },
  );
  const { apiKey, convexUrl } = answers;
  console.log(apiKey, convexUrl);
  if (!key) {
    appendFile(".env", `\nWORKER_API_KEY=${apiKey}\n`, (err) => {
      if (err) throw err;
      console.log("Saved WORKER_API_KEY to .env");
    });
  }
  if (!url) {
    appendFile(".env", `\nVITE_CONVEX_URL=${convexUrl}\n`, (err) => {
      if (err) throw err;
      console.log("Saved VITE_CONVEX_URL to .env");
    });
  }
  if (!apiKey || !convexUrl) {
    throw new Error(
      "Missing environment variables WORKER_API_KEY or CONVEX_URL",
    );
  }
  const client = new ConvexClient(convexUrl);
  console.log("Loading llama3...");
  await retryWithBackoff(async () => {
    try {
      const resp = await pullOllama("llama3");
      console.log(await resp.text());
    } catch (e) {
      console.error(e);
      throw { error: String(e), retry: true };
    }
  });
  console.log("Loaded ✅");
  for (;;) {
    console.debug("Waiting for work...");
    await waitForWork(client);
    console.debug("Attempting work...");
    let work = await client.mutation(api.workers.giveMeWork, { apiKey });
    while (work) {
      const start = Date.now();
      work = await doWork(work, client, apiKey);
      console.log("Finished:", Date.now() - start, "ms");
    }
  }
}
main().then(console.log).catch(console.error);
