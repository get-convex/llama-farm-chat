import { Button } from "@/components/ui/button";
import { FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";
import * as webllm from "@mlc-ai/web-llm";
import * as Progress from "@radix-ui/react-progress";
import { Input } from "./components/ui/input";
import { Send } from "./Chat";
import { ConvexReactClient, useConvex } from "convex/react";
import { ConvexClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { FunctionReturnType } from "convex/server";
import { WorkerHeartbeatInterval } from "@shared/config";
import { hasDelimeter } from "worker/client";

type LoadingState = { progress: number; text: string };

const MODEL = "TinyLlama-1.1B-Chat-v0.4-q4f32_1-1k";
// "Llama-3-8B-Instruct-q4f16_1",

class Llama {
  disposed = false;

  static async load(
    loadingCb: (loading: LoadingState) => void,
    client: ConvexClient,
    apiKey: string
  ) {
    loadingCb({ progress: 0, text: "Starting..." });
    const url = new URL("./lib/llamaWebWorker.ts", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    const appConfig = webllm.prebuiltAppConfig;
    appConfig.useIndexedDBCache = true;
    const engine = await webllm.CreateWebWorkerEngine(worker, MODEL, {
      initProgressCallback: (progressReport) => {
        console.log(progressReport);
        loadingCb({
          progress: progressReport.progress * 100,
          text: progressReport.text,
        });
      },
      appConfig,
    });
    return new Llama(worker, engine, client, apiKey);
  }

  constructor(
    private worker: Worker,
    public engine: webllm.EngineInterface,
    private client: ConvexClient,
    private apiKey: string
  ) {}

  async dispose() {
    this.disposed = true;
    await this.engine.unload();
    this.worker.terminate();
  }

  async workLoop() {
    while (!this.disposed) {
      let unsubscribe: undefined | (() => void);
      try {
        await new Promise<void>((resolve, reject) => {
          unsubscribe = this.client.onUpdate(
            api.workers.isThereWork,
            {},
            async (isWork) => {
              if (isWork) {
                resolve();
              }
            },
            reject
          );
        });
      } finally {
        if (unsubscribe) {
          unsubscribe();
        }
      }
      let work = await this.client.mutation(api.workers.giveMeWork, {
        apiKey: this.apiKey,
      });
      while (work && !this.disposed) {
        const start = Date.now();
        work = await this.doWork(work);
        console.log("Finished:", Date.now() - start, "ms");
      }
    }
  }

  async doWork(
    work: FunctionReturnType<typeof api.workers.giveMeWork>
  ): Promise<FunctionReturnType<typeof api.workers.giveMeWork>> {
    if (!work) {
      return null;
    }
    const { messages, jobId } = work;
    const timerId = setInterval(() => {
      console.debug("Still working...");
      this.client
        .mutation(api.workers.imStillWorking, { apiKey: this.apiKey, jobId })
        .then(console.log)
        .catch(console.error);
    }, WorkerHeartbeatInterval);
    try {
      if (work.stream) {
        const completion = await this.engine.chat.completions.create({
          stream: true,
          messages,
          temperature: 0.5,
          max_gen_len: 1024,
        });
        let response = "";
        for await (const chunk of completion) {
          const part = chunk.choices[0].delta.content;
          if (part) {
            response += part;
          }
          if (hasDelimeter(response)) {
            await this.client.mutation(api.workers.submitWork, {
              message: response,
              state: "streaming",
              apiKey: this.apiKey,
              jobId,
            });
            response = "";
          }
          return this.client.mutation(api.workers.submitWork, {
            message: response,
            state: "streaming",
            apiKey: this.apiKey,
            jobId,
          });
        }
      } else {
        const completion = await this.engine.chat.completions.create({
          stream: false,
          messages,
        });
        const message = completion.choices[0].message;
        return this.client.mutation(api.workers.submitWork, {
          message: message.content ?? "",
          state: "success",
          apiKey: this.apiKey,
          jobId,
        });
      }
    } catch (e) {
      console.error(e);
      return this.client.mutation(api.workers.submitWork, {
        message: e instanceof Error ? e.message : String(e),
        state: "failed",
        apiKey: this.apiKey,
        jobId,
      });
    } finally {
      clearInterval(timerId);
    }
    throw new Error("Unreachable");
  }
}

export function LlamaWorker() {
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [llama, setLlama] = useState<Llama>();
  const [name, setName] = useState<string>();

  useEffect(() => {
    () => {
      llama && void llama.dispose();
    };
  }, [llama]);
  const startLoading = async () => {
    const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    try {
      const apiKey = await client.mutation(api.workers.signMeUp, {
        name,
      });
      const llama = await Llama.load(setLoading, client, apiKey);
      setLlama(llama);
    } catch (e: any) {
      console.error("Failed to load model", e);
    } finally {
      setLoading(null);
    }
  };

  const [messageToSend, setMessageToSend] = useState("");
  const sendSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!llama || !messageToSend) {
        return;
      }
      const message = messageToSend;
      setMessageToSend("");

      const completion = await llama.engine.chat.completions.create({
        stream: true,
        messages: [{ role: "user", content: message }],
        temperature: 0.5,
        max_gen_len: 1024,
      });
      let response = "";
      for await (const chunk of completion) {
        const curDelta = chunk.choices[0].delta.content;
        if (curDelta) {
          response += curDelta;
        }
      }
      console.log(response);
      const stats = await llama.engine.runtimeStatsText();
      console.log(stats);
    },
    [messageToSend, llama]
  );

  // TODO:
  // [ ] Use AI town's waitlist's animated progress bar!
  return (
    <div className="flex-1 flex flex-col gap-2 items-center justify-center">
      <h2 className="text-4xl">Be a Llama!</h2>
      <p className="text-lg text-center p-4">
        Did you always want to be a llama when you grew up?
        <br />
        Join the llama farm and live your childhood dreams!
      </p>
      {!llama && !loading && (
        <Button
          variant={"default"}
          disabled={!!loading}
          onClick={() => void startLoading()}
        >
          Download model
        </Button>
      )}
      {!!loading && (
        <>
          <Progress.Root
            value={loading.progress}
            className="relative overflow-hidden bg-my-neutral-sprout rounded-full w-[300px] h-[25px]"
            style={{ transform: "translateZ(0)" }}
          >
            <Progress.Indicator
              className="bg-my-light-green w-full h-full transition-transform duration-[660ms] ease-[cubic-bezier(0.65, 0, 0.35, 1)]"
              style={{ transform: `translateX(-${100 - loading.progress}%)` }}
            />
          </Progress.Root>
          <p className="text-small text-center p-4 max-w-lg">{loading.text}</p>
        </>
      )}
      {llama && (
        <form
          className="p-2 mt-4 flex items-center gap-2"
          onSubmit={(e) => void sendSubmit(e)}
        >
          <Input
            type="text"
            value={messageToSend}
            onChange={(e) => setMessageToSend(e.target.value)}
            className="flex-1 resize-none bg-my-neutral-sprout dark:placeholder-my-dark-green dark:text-my-light-tusk dark:bg-my-light-green"
            placeholder="Type your message..."
          />
          <Send
            type="submit"
            className={
              "my-light-green fill-my-light-green disabled:cursor-not-allowed"
            }
            title={"hi"}
            disabled={false}
          />
        </form>
      )}
    </div>
  );
}
