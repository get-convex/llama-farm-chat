import { api } from "@convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { FunctionReturnType } from "convex/server";
import { CompletionsAPI } from "./openai_types";
import { completionModels, WorkerHeartbeatInterval } from "./config";

export function hasDelimeter(response: string) {
  return (
    response.includes("\n") ||
    response.includes(".") ||
    response.includes("?") ||
    response.includes("!") ||
    response.includes(",") ||
    response.length > 100
  );
}
export async function waitForWork(client: ConvexClient) {
  let unsubscribe: undefined | (() => void);
  try {
    await new Promise<void>((resolve, reject) => {
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
  } catch (e) {
    console.error("Error waiting for work", e);
  } finally {
    if (unsubscribe) unsubscribe();
  }
}

export async function doWork(
  work: FunctionReturnType<typeof api.workers.giveMeWork>,
  client: ConvexClient,
  apiKey: string,
  completions: CompletionsAPI,
  defaultModel: string,
) {
  if (!work) {
    return null;
  }
  const model = work.model ?? defaultModel;
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
    if (work.stream) {
      const completion = await completions.create({
        stream: true,
        messages,
        model,
        temperature: 0.5,
        max_gen_len: 1024,
      });
      let totalLength = 0;
      let response = "";
      for await (const chunk of completion) {
        const part = chunk.choices[0].delta.content;
        if (part) {
          response += part;
        }
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
      return client.mutation(api.workers.submitWork, {
        message: response,
        state: "success",
        apiKey,
        jobId,
      });
    } else {
      const completion = await completions.create({
        stream: false,
        model,
        messages,
      });
      const message = completion.choices[0].message;
      console.debug("Response:", message);
      return client.mutation(api.workers.submitWork, {
        message: message.content ?? "",
        state: "success",
        apiKey,
        jobId,
      });
    }
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
