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

type LoadingState = { progress: number; text: string };

const MODEL = "Llama-3-8B-Instruct-q4f16_1";

type State =
  | { type: "signingUp" }
  | { type: "waitingForWork"; stats: string }
  | { type: "loadingWork" }
  | {
      type: "working";
      job: FunctionReturnType<typeof api.workers.giveMeWork>;
    };

class Llama {
  disposed = false;

  static async load(
    loadingCb: (loading: LoadingState) => void,
    stateCb: (state: State) => void,
    client: ConvexClient,
    name: string
  ) {
    loadingCb({ progress: 0, text: "Starting..." });
    const url = new URL("./lib/llamaWebWorker.ts", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    const appConfig = webllm.prebuiltAppConfig;
    appConfig.useIndexedDBCache = true;
    const engine = await webllm.CreateWebWorkerEngine(worker, MODEL, {
      initProgressCallback: (progressReport) => {
        loadingCb({
          progress: progressReport.progress * 100,
          text: progressReport.text,
        });
      },
      appConfig,
    });
    return new Llama(worker, engine, client, name, stateCb);
  }

  constructor(
    private worker: Worker,
    public engine: webllm.EngineInterface,
    private client: ConvexClient,
    private name: string,
    private stateCb: (state: State) => void
  ) {}

  async dispose() {
    this.disposed = true;
    await this.engine.unload();
    this.worker.terminate();
  }

  async workLoop() {
    this.stateCb({ type: "signingUp" });
    const apiKey = await this.client.mutation(api.workers.signMeUp, {
      name: this.name,
    });
    console.log("Signed up", apiKey);
    while (!this.disposed) {
      const stats = await this.engine.runtimeStatsText();
      this.stateCb({ type: "waitingForWork", stats });
      console.log("Waiting for work...");
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
      this.stateCb({ type: "loadingWork" });
      let work = await this.client.mutation(api.workers.giveMeWork, {
        apiKey,
      });
      console.log("Starting", work);
      while (work && !this.disposed) {
        const start = Date.now();
        work = await this.doWork(work, apiKey);
        console.log("Finished:", Date.now() - start, "ms");
      }
    }
  }

  async doWork(
    work: FunctionReturnType<typeof api.workers.giveMeWork>,
    apiKey: string
  ): Promise<FunctionReturnType<typeof api.workers.giveMeWork>> {
    if (!work) {
      return null;
    }
    this.stateCb({ type: "working", job: work });
    const { messages, jobId } = work;
    const timerId = setInterval(() => {
      console.debug("Still working...");
      this.client
        .mutation(api.workers.imStillWorking, { apiKey, jobId })
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
              apiKey,
              jobId,
            });
            console.log(response);
            response = "";
          }
        }
        return this.client.mutation(api.workers.submitWork, {
          message: response,
          state: "streaming",
          apiKey,
          jobId,
        });
      } else {
        const completion = await this.engine.chat.completions.create({
          stream: false,
          messages,
        });
        const message = completion.choices[0].message;
        return this.client.mutation(api.workers.submitWork, {
          message: message.content ?? "",
          state: "success",
          apiKey,
          jobId,
        });
      }
    } catch (e) {
      console.error(e);
      return this.client.mutation(api.workers.submitWork, {
        message: e instanceof Error ? e.message : String(e),
        state: "failed",
        apiKey,
        jobId,
      });
    } finally {
      clearInterval(timerId);
    }
  }
}

export function LlamaWorker() {
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [llama, setLlama] = useState<Llama>();
  const [name, setName] = useState<string>("");
  const [state, setState] = useState<State>();

  useEffect(() => {
    () => {
      llama && void llama.dispose();
    };
  }, [llama]);
  const startLoading = async () => {
    console.log("Starting...");
    const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    console.log(client);
    try {
      if (!name) {
        throw new Error("Please enter a name");
      }
      const llama = await Llama.load(setLoading, setState, client, name);
      setLlama(llama);
      void llama.workLoop();
    } catch (e: any) {
      console.error("Failed to load model", e);
    } finally {
      setLoading(null);
    }
  };

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
        <>
          <form
            className="p-2 mt-4 flex items-center gap-2"
            onSubmit={() => void startLoading()}
          >
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 resize-none bg-my-neutral-sprout dark:placeholder-my-dark-green dark:text-my-light-tusk dark:bg-my-light-green"
              placeholder="Worker name"
            />
            <Button type="submit">Start download</Button>
          </form>
        </>
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
      {!!state && <pre>{JSON.stringify(state, null, 2)}</pre>}
    </div>
  );
}
