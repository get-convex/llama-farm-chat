import { api } from "@convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { FunctionReturnType } from "convex/server";
import { SimpleCompletionsAPI } from "./llm";
import { WORKER_HEARTBEAT_INTERVAL } from "./config";

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
  completions: SimpleCompletionsAPI,
) {
  if (!work) {
    return null;
  }
  console.debug(work);
  const { messages, jobId } = work;
  const timerId = setInterval(() => {
    console.debug("Still working...");
    client
      .mutation(api.workers.imStillWorking, { apiKey, jobId })
      .then(console.log)
      .catch(console.error);
  }, WORKER_HEARTBEAT_INTERVAL);
  try {
    if (work.stream) {
      const completion = await completions.chatStream(messages);
      let totalLength = 0;
      let response = "";
      for await (const part of completion) {
        response += part;
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
      const message = await completions.chat(messages);
      console.debug("Response:", message);
      return client.mutation(api.workers.submitWork, {
        message,
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
