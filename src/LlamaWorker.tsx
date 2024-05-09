import { Button } from "@/components/ui/button";
import { createContext, useContext, useEffect, useState } from "react";
import * as webllm from "@mlc-ai/web-llm";
import * as Progress from "@radix-ui/react-progress";
import { Input } from "./components/ui/input";
import { ConvexClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { FunctionReturnType } from "convex/server";
import { WorkerHeartbeatInterval } from "@shared/config";
import { hasDelimeter } from "../shared/worker";
import { useLocalStorage } from "usehooks-ts";

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
    apiKey: string,
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
    return new Llama(worker, engine, client, apiKey, stateCb);
  }

  constructor(
    private worker: Worker,
    public engine: webllm.EngineInterface,
    private client: ConvexClient,
    private apiKey: string,
    public stateCb: (state: State) => void,
  ) {}

  async dispose() {
    this.disposed = true;
    await this.engine.unload();
    this.worker.terminate();
  }

  async workLoop() {
    this.stateCb({ type: "signingUp" });
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
            reject,
          );
        });
      } catch (e) {
        console.error("Error waiting for work", e);
      } finally {
        if (unsubscribe) {
          unsubscribe();
        }
      }
      this.stateCb({ type: "loadingWork" });
      let work = await this.client.mutation(api.workers.giveMeWork, {
        apiKey: this.apiKey,
      });
      console.log("Starting", work);
      while (work && !this.disposed) {
        const start = Date.now();
        work = await this.doWork(work, this.apiKey);
        console.log("Finished:", Date.now() - start, "ms");
      }
    }
  }

  async doWork(
    work: FunctionReturnType<typeof api.workers.giveMeWork>,
    apiKey: string,
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
          state: "success",
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
  const { llama, state, loading, setApiKey } = useContext(LlamaContext) ?? {};
  if (!setApiKey) {
    throw new Error("Missing LlamaProvider");
  }

  // TODO:
  // [ ] Use AI town's waitlist's animated progress bar!
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <h2 className="text-4xl">Be a Llama!</h2>
      <p className="p-4 text-center text-lg">
        Did you always want to be a llama shepherd when you grew up?
        <br />
        Join the llama farm and live your childhood dreams!
      </p>
      {!llama && !loading && (
        <>
          <form
            className="mt-4 flex items-center gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const apiKey = (e.target as any).apiKey.value;
              setApiKey(apiKey);
            }}
          >
            <Input
              type="text"
              name={"apiKey"}
              className="flex-1 resize-none bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk dark:placeholder-my-dark-green"
              placeholder="API key"
              required
            />
            <Button type="submit">Start</Button>
          </form>
        </>
      )}
      {!!loading && (
        <>
          <LlamaProgressBar loading={loading} />
          <p className="text-small max-w-lg p-4 text-center">{loading.text}</p>
        </>
      )}
      {!!state && <pre>{JSON.stringify(state, null, 2)}</pre>}
    </div>
  );
}

function LlamaProgressBar({ loading }: { loading: LoadingState }) {
  return (
    <>
      <Progress.Root
        value={loading.progress}
        className="relative h-[25px] w-[200px] overflow-hidden rounded-full bg-my-neutral-sprout md:w-[300px]"
        style={{ transform: "translateZ(0)" }}
      >
        <Progress.Indicator
          className="duration-[660ms] ease-[cubic-bezier(0.65, 0, 0.35, 1)] h-full w-full bg-my-dark-green transition-transform"
          style={{ transform: `translateX(-${100 - loading.progress}%)` }}
        />
      </Progress.Root>
    </>
  );
}

export function LlamaStatus() {
  const { state, llama, loading } = useContext(LlamaContext) ?? {};
  if (loading)
    return (
      <div className="pl-4">
        <div className="flex items-center">
          <LlamaProgressBar loading={loading} />
          {!llama?.disposed && (
            <Button
              className="text-lg"
              variant={"ghost"}
              onClick={() => void llama?.dispose().catch(console.error)}
            >
              🛑
            </Button>
          )}
        </div>
        <p className="text-small overflow-hidden text-ellipsis whitespace-nowrap p-0">
          {loading.text}
        </p>
      </div>
    );
  if (state) {
    return (
      <div className="flex gap-2 px-4">
        <p>
          {state.type === "waitingForWork"
            ? "🦙💤"
            : state.type === "loadingWork"
              ? "🦙📨"
              : state.type === "working"
                ? "🦙💬"
                : "🦙🪦"}
          {"  "}
        </p>
        {!llama?.disposed && (
          <Button
            className="px-4"
            onClick={() => void llama?.dispose().catch(console.error)}
          >
            🛑
          </Button>
        )}
      </div>
    );
  }
  return null;
}

export const LlamaContext = createContext<{
  llama: Llama | undefined;
  state: State | undefined;
  loading: LoadingState | null;
  setApiKey: (apiKey: string) => void;
} | null>(null);

export function LlamaProvider({ children }: { children: React.ReactNode }) {
  const [llama, setLlama] = useState<Llama>();
  const [state, setState] = useState<State>();
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [apiKey, setApiKey] = useLocalStorage("llama-farm-api-key", "");

  useEffect(() => {
    if (!llama && apiKey && !loading) {
      const client = new ConvexClient(
        import.meta.env.VITE_CONVEX_URL as string,
      );
      if (!apiKey) {
        throw new Error("API key is required to start working");
      }
      Llama.load(setLoading, setState, client, apiKey)
        .then((llama) => {
          setLlama(llama);
          void llama.workLoop();
        })
        .catch((e) => console.error("Failed to load model", e))
        .finally(() => setLoading(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  return (
    <LlamaContext.Provider value={{ llama, state, loading, setApiKey }}>
      {children}
    </LlamaContext.Provider>
  );
}
