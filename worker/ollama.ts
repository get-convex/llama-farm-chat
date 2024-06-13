import {
  join,
  Config,
  completionsViaFetch,
  SimpleEmbeddingsAPI,
  simpleCompletionsAPI,
} from "@shared/llm";
import { retryWithBackoff } from "@shared/llm";
import { Embedding, EmbeddingsAPI } from "@shared/openai_types";

const CHAT_MODEL = "llama3";
const EMBEDDING_MODEL = "mxbai-embed-large"; // dim 1024

export const CONFIG: Config = {
  url: "http://127.0.0.1:11434",
  extraStopWords: ["<|eot_id|>"],
  // embeddingsModel: "llama3", // dim 4096
  onError: async (response, model) => {
    if (response.status === 404) {
      const error = await response.text();
      return await tryPullOllama(model, error);
    }
    return false;
  },
};

export const completions = completionsViaFetch(CONFIG);

export const { chat, stream } = simpleCompletionsAPI(completions, CHAT_MODEL);

export const embeddings: EmbeddingsAPI = {
  async create(body) {
    const texts =
      typeof body.input === "string" || typeof body.input[0] === "number"
        ? [body.input]
        : body.input;
    const data: Embedding[] = [];
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];
      const { result } = await retryWithBackoff(async () => {
        const resp = await fetch(join(CONFIG.url, "/api/embeddings"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: body.model, prompt: text }),
        });
        if (resp.status === 404) {
          const error = await resp.text();
          const retry = await tryPullOllama(body.model, error);
          if (retry) throw { error, retry: true };
          throw new Error(
            `Failed to fetch embeddings: ${resp.status} ${error}`,
          );
        }
        return (await resp.json()).embedding as number[];
      });
      data.push({ embedding: result, index, object: "embedding" });
    }
    return {
      data,
      model: body.model,
      object: "list",
      usage: {
        prompt_tokens: NaN,
        total_tokens: NaN,
      },
    };
  },
};

export const { embed, embedBatch }: SimpleEmbeddingsAPI = {
  embed: async (text) => {
    const { data } = await embeddings.create({
      input: text,
      model: EMBEDDING_MODEL,
    });
    return data[0].embedding;
  },
  embedBatch: async (texts) => {
    const { data } = await embeddings.create({
      input: texts,
      model: EMBEDDING_MODEL,
    });
    const allembeddings = data;
    allembeddings.sort((a, b) => a.index - b.index);
    return allembeddings.map(({ embedding }) => embedding);
  },
};

async function tryPullOllama(model: string, error: string) {
  if (error.includes("try pulling")) {
    console.error("Model not found, pulling from Ollama");
    const pullResp = await pullOllama(model);
    if (!pullResp.ok) {
      throw new Error(
        `Failed to pull model: ${pullResp.status}: ${pullResp.statusText}`,
      );
    } else {
      return true;
    }
  }
  return false;
}

export async function pullOllama(model: string) {
  return fetch(join(CONFIG.url, "/api/pull"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: model }),
  });
}
