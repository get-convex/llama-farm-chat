import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  CompletionsAPI,
  CreateEmbeddingResponse,
  EmbeddingsAPI,
} from "./openai_types";
import { retryWithBackoff } from "./retryWithBackoff";

export type Config = {
  url: string;
  onError?: (response: Response, model: string) => boolean | Promise<boolean>;
  extraStopWords?: string[];
};

export const CONFIG = {
  // Together AI:
  url: "https://api.together.xyz",
  chatModel: "meta-llama/Llama-3-8b-chat-hf",
  embeddingModel: "togethercomputer/m2-bert-80M-8k-retrieval", // dim 768
  // OpenAI:
  // url: "https://api.openai.com",
  // chatModel: "gpt-3.5-turbo-16k",
  // embeddingModel: "text-embedding-ada-002", // dim 1536
};
export const completions = completionsViaFetch(CONFIG);
export const embeddings = embeddingsViaFetch(CONFIG);
export const { chat, stream } = simpleCompletionsAPI(
  completions,
  CONFIG.chatModel,
);
export const { embed, embedBatch } = simpleEmbeddingsAPI(
  embeddings,
  CONFIG.embeddingModel,
);

export type SimpleCompletionsAPI = {
  chat: (messages: ChatCompletionMessageParam[]) => Promise<string>;
  stream: (
    messages: ChatCompletionMessageParam[],
  ) => Promise<AsyncIterable<string>>;
};

// const api = simpleCompletionsAPI(new OpenA().chat.completions, "gpt-4");
export function simpleCompletionsAPI(
  api: CompletionsAPI,
  model: string,
): SimpleCompletionsAPI {
  return {
    chat: async (messages: ChatCompletionMessageParam[]): Promise<string> => {
      const response = await api.create({
        model,
        messages,
        stream: false,
      });
      if (!response.choices[0].message?.content) {
        throw new Error(
          "Unexpected result from OpenAI: " + JSON.stringify(response),
        );
      }
      return response.choices[0].message.content;
    },
    stream: async (
      messages: ChatCompletionMessageParam[],
    ): Promise<AsyncIterable<string>> => {
      const response = await api.create({
        model,
        messages,
        stream: true,
      });
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of response) {
            if (chunk.choices[0].delta?.content) {
              yield chunk.choices[0].delta.content;
            }
          }
        },
      };
    },
  };
}

export type SimpleEmbeddingsAPI = {
  embed: (text: string) => Promise<Array<number>>;
  embedBatch: (texts: string[]) => Promise<Array<Array<number>>>;
};

// const api = simpleEmbeddingsAPI(new OpenAI().embeddings, "text-embedding-ada-002");
export function simpleEmbeddingsAPI(
  api: EmbeddingsAPI,
  model: string,
): SimpleEmbeddingsAPI {
  return {
    embed: async (text: string): Promise<Array<number>> => {
      const json = await api.create({
        input: text,
        model,
      });
      return json.data[0].embedding;
    },
    embedBatch: async (texts: string[]): Promise<Array<Array<number>>> => {
      const json = await api.create({
        input: texts,
        model,
      });
      const allembeddings = json.data;
      allembeddings.sort((a, b) => a.index - b.index);
      return allembeddings.map(({ embedding }) => embedding);
    },
  };
}

export function completionsViaFetch(config: Config): CompletionsAPI {
  return {
    async create(body) {
      if (config.extraStopWords) {
        body.stop = body.stop
          ? typeof body.stop === "string"
            ? [body.stop, ...config.extraStopWords]
            : body.stop.concat(...config.extraStopWords)
          : config.extraStopWords;
      }

      const { result, retries, ms } = await retryWithBackoff(async () => {
        const result = await fetch(join(config.url, "/v1/chat/completions"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...AuthHeaders(),
          },
          body: JSON.stringify(body),
        });
        if (!result.ok) {
          const retry =
            !!config.onError && (await config.onError(result, body.model));

          const error = await result.text();
          console.error({ error });
          throw {
            retry: retry || shouldRetry(result),
            error: new Error(
              `Chat completion failed with code ${result.status}: ${error}`,
            ),
          };
        }
        return result;
      });
      if (retries > 0) {
        console.log("Retries:", retries, "ms:", ms);
      }
      if (body.stream) {
        const body = result.body;
        if (!body) throw new Error("No body in response");
        return {
          async *[Symbol.asyncIterator]() {
            for await (const data of splitStream(body)) {
              if (data.startsWith("data: ")) {
                if (data.startsWith("data: [DONE]")) {
                  return;
                }
                // try {
                const json = JSON.parse(
                  data.substring("data: ".length),
                ) as ChatCompletionChunk;
                yield json;
                // } catch (e) {
                // }
              } else {
                console.debug("Unexpected data:", data);
              }
            }
          },
        } as AsyncIterable<ChatCompletionChunk>;
      } else {
        const json = (await result.json()) as ChatCompletion;
        if (json.choices[0].message?.content === undefined) {
          throw new Error(
            "Unexpected result from OpenAI: " + JSON.stringify(json),
          );
        }
        return json;
      }
    },
  } as CompletionsAPI;
}

export function embeddingsViaFetch(config: Config): EmbeddingsAPI {
  return {
    create: async (body) => {
      const {
        result: json,
        retries,
        ms,
      } = await retryWithBackoff(async () => {
        const result = await fetch(join(config.url, "/v1/embeddings"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...AuthHeaders(),
          },
          body: JSON.stringify(body),
        });
        if (!result.ok) {
          const retry =
            !!config.onError && (await config.onError(result, body.model));
          throw {
            retry: retry || shouldRetry(result),
            error: new Error(
              `Embedding failed with code ${result.status}: ${await result.text()}`,
            ),
          };
        }
        return (await result.json()) as CreateEmbeddingResponse;
      });
      console.debug({ usage: json.usage?.total_tokens, retries, ms });
      return json;
    },
  };
}

function shouldRetry(response: Response) {
  return (
    response.headers.get("x-should-retry") !== "false" &&
    (response.headers.get("x-should-retry") === "true" ||
      response.status === 408 || // Timeout
      response.status === 409 || // Lock timeout
      response.status === 429 || // Rate limit
      response.status >= 500)
  ); // Internal server error
}

export async function* splitStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let lastFragment = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush the last fragment now that we're done
        if (lastFragment !== "") {
          yield lastFragment;
        }
        break;
      }
      const data = new TextDecoder().decode(value);
      lastFragment += data;
      const parts = lastFragment.split("\n\n");
      // Yield all except for the last part
      for (let i = 0; i < parts.length - 1; i += 1) {
        yield parts[i];
      }
      // Save the last part as the new last fragment
      lastFragment = parts[parts.length - 1];
    }
  } finally {
    reader.releaseLock();
  }
}

export function join(base: string, path: string) {
  if (base.endsWith("/") && path.startsWith("/")) {
    return base + path.slice(1);
  } else if (!base.endsWith("/") && !path.startsWith("/")) {
    return base + "/" + path;
  } else {
    return base + path;
  }
}

export const AuthHeaders = (): Record<string, string> =>
  process.env.LLM_API_KEY
    ? { Authorization: "Bearer " + process.env.LLM_API_KEY }
    : {};
