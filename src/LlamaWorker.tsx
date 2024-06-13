import { Button } from "@/components/ui/button";
import { createContext, useContext, useEffect, useState } from "react";
import * as webllm from "@mlc-ai/web-llm";
import * as Progress from "@radix-ui/react-progress";
import { Input } from "./components/ui/input";
import { ConvexClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { FunctionReturnType } from "convex/server";
import { useLocalStorage, useSessionStorage } from "usehooks-ts";
import { Link } from "react-router-dom";
import LLMWorker from "./lib/llamaWebWorker?worker&inline";
import { doWork, waitForWork } from "@shared/worker";
import { simpleCompletionsAPI, type CompletionsAPI } from "@shared/llm";

type LoadingState = { progress: number; text: string };

const MODEL = "Llama-3-8B-Instruct-q4f16_1";

type State =
  | { type: "waitingForWork"; stats: string }
  | { type: "loadingWork" }
  | {
      type: "working";
      job: FunctionReturnType<typeof api.workers.giveMeWork>;
    }
  | { type: "stopped" };

class Llama {
  disposed = false;

  static async load(
    loadingCb: (loading: LoadingState) => void,
    stateCb: (state: State) => void,
    client: ConvexClient,
    apiKey: string,
    generation: number,
  ) {
    loadingCb({ progress: 0, text: "Starting..." });
    const worker = new LLMWorker();
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
    return new Llama(worker, engine, client, apiKey, stateCb, generation);
  }

  constructor(
    private worker: Worker,
    public engine: webllm.EngineInterface,
    private client: ConvexClient,
    private apiKey: string,
    public stateCb: (state: State) => void,
    public generation: number,
  ) {}

  async dispose() {
    this.disposed = true;
    this.stateCb({ type: "stopped" });
    await this.engine.unload();
    this.worker.terminate();
  }

  async workLoop() {
    const completions = {
      create: async (body) => {
        // A few modififications to get the types & runtime working.
        const { model: _m, tool_choice: _t, ...modified } = body;
        return await this.engine.chat.completions.create({
          ...modified,
          max_gen_len: 1024,
        });
      },
    } as CompletionsAPI;
    const simple = simpleCompletionsAPI(completions, MODEL);
    while (!this.disposed) {
      const stats = await this.engine.runtimeStatsText();
      if (this.disposed) return;
      this.stateCb({ type: "waitingForWork", stats });
      await waitForWork(this.client);
      if (this.disposed) return;
      this.stateCb({ type: "loadingWork" });
      let work = await this.client.mutation(api.workers.giveMeWork, {
        apiKey: this.apiKey,
      });
      console.log("Starting", work);
      while (work && !this.disposed) {
        const start = Date.now();
        this.stateCb({ type: "working", job: work });
        work = await doWork(work, this.client, this.apiKey, simple);
        console.log("Finished:", Date.now() - start, "ms");
      }
    }
  }
}

export function LlamaWorker() {
  // llc := llama context
  const llc = useContext(LlamaContext);
  if (!llc) {
    throw new Error("Missing LlamaProvider");
  }
  const { loading, enabled } = llc;

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
      {loading ? (
        <>
          <LlamaProgressBar loading={loading} />
          <p className="text-small max-w-lg p-4 text-center">{loading.text}</p>
        </>
      ) : (
        <>
          {!llc.llama && (
            <>
              <form
                className="m-4 flex items-center gap-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const apiKey = (e.target as any).apiKey.value;
                  llc.setApiKey(apiKey);
                }}
              >
                <Input
                  type="text"
                  name={"apiKey"}
                  className="flex-1 resize-none bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk dark:placeholder-my-dark-green"
                  placeholder={llc.apiKey || "API key"}
                  required
                />
                <Button type="submit">Set API Key</Button>
              </form>
            </>
          )}
          {llc.apiKey && (
            <Button onClick={() => llc.setEnabled(!enabled)}>
              {enabled ? "Stop" : "Start"}
            </Button>
          )}
        </>
      )}
      {!!llc.state && <pre>{JSON.stringify(llc.state, null, 2)}</pre>}
    </div>
  );
}

function LlamaProgressBar({ loading }: { loading: LoadingState }) {
  if (!loading.progress) return <div />;
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
  const llc = useContext(LlamaContext);
  if (!llc) throw new Error("Missing LlamaProvider");
  const { state, loading, enabled, setEnabled } = llc;
  if (loading)
    return (
      <Link to="/worker" className="flex max-w-[calc(100%-150px)] items-center">
        <div className="w-full pl-4">
          <LlamaProgressBar loading={loading} />
          <p className="text-small overflow-hidden text-ellipsis whitespace-nowrap p-0 text-my-white-baja">
            {loading.text}
          </p>
        </div>
      </Link>
    );
  if (state) {
    return (
      <Link to="/worker" className="flex gap-2 px-4">
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
      </Link>
    );
  }
  if (!enabled && llc.apiKey) {
    return (
      <div className="flex gap-2 px-4">
        <Button onClick={() => setEnabled(true)}>Run 🦙 in your browser</Button>
      </div>
    );
  }
  return <div />;
}

export const LlamaContext = createContext<{
  llama: Llama | undefined;
  state: State | undefined;
  loading: LoadingState | null;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
} | null>(null);

export function LlamaProvider({ children }: { children: React.ReactNode }) {
  const [llama, setLlama] = useState<Llama>();
  const [state, setState] = useState<State>();
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [apiKey, setApiKey] = useLocalStorage("llama-farm-api-key", "");
  // We only run one worker per browser, using local storage as the lock.
  // We increment the generation to signal older workers to stop.
  const [generation, setGeneration] = useLocalStorage(
    "llama-farm-worker-generation",
    0,
  );
  const [enabled, setEnabled] = useSessionStorage(
    "llama-farm-worker-enabled",
    false,
  );

  useEffect(() => {
    if (llama && !llama.disposed && generation !== llama.generation) {
      llama.dispose().catch(console.error);
      setEnabled(false);
    }
    return () => {
      if (llama && !llama.disposed) {
        llama.dispose().catch(console.error);
      }
    };
  }, [generation, llama, setEnabled]);

  useEffect(() => {
    if (!llama && apiKey && !loading && enabled) {
      const client = new ConvexClient(
        import.meta.env.VITE_CONVEX_URL as string,
      );
      if (!apiKey) {
        throw new Error("API key is required to start working");
      }
      setGeneration(generation + 1);
      Llama.load(setLoading, setState, client, apiKey, generation + 1)
        .then((llama) => {
          setLlama(llama);
          void llama.workLoop();
        })
        .catch((e) => console.error("Failed to load model", e))
        .finally(() => setLoading(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, enabled]);

  return (
    <LlamaContext.Provider
      value={{ llama, state, loading, apiKey, setApiKey, enabled, setEnabled }}
    >
      {children}
    </LlamaContext.Provider>
  );
}
