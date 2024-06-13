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
  // chatModel: "gpt-4o",
  // embeddingModel: "text-embedding-ada-002", // dim 1536
};
// Retry after this much time, based on the retry number.
const RETRY_BACKOFF = [1000, 10000, 20000]; // In ms
const RETRY_JITTER = 100; // In ms

/**
 * Easy to use API for OpenAI-compliant LLM servers
 */
export const completions = completionsViaFetch(CONFIG);
export const { chat, chatStream } = simpleCompletionsAPI(
  completions,
  CONFIG.chatModel,
);
export type SimpleCompletionsAPI = {
  /**
   * Simple non-streaming interface to LLM chat completions.
   * @param messages The messages like you'd pass to OpenAI's .chat.completions.create
   * @returns A string of the chat completion.
   */
  chat: (messages: ChatCompletionMessageParam[]) => Promise<string>;
  /**
   * Simple streaming interface to LLM chat completions.
   * @param messages The messages like you'd pass to OpenAI's .chat.completions.create
   * @returns An async iterable of strings, each a part of the chat completion.
   */
  chatStream: (
    messages: ChatCompletionMessageParam[],
  ) => Promise<AsyncIterable<string>>;
};

export const embeddings = embeddingsViaFetch(CONFIG);
export const { embed, embedBatch } = simpleEmbeddingsAPI(
  embeddings,
  CONFIG.embeddingModel,
);
export type SimpleEmbeddingsAPI = {
  /**
   * Simple API to get an embedding for a single text.
   * @param text The text to create an embedding for
   * @returns An array of numbers representing the embedding
   */
  embed: (text: string) => Promise<Array<number>>;
  /**
   * Simple API to get embeddings for multiple texts in batch.
   * @param texts An array of texts to create embeddings for.
   * @returns An array of embeddings (array of numbers), in the order of the input texts.
   */
  embedBatch: (texts: string[]) => Promise<Array<Array<number>>>;
};

/**
 * Completions API
 */

/**
 * Makes a simple API for chat completions from an OpenAI API.
 * @param api Equivalent of OpenAI's .chat.completions or completionsViaFetch(CONFIG)
 * @param model The model name, like "gpt-4" or "llama3"
 * @returns Two functions: `chat` and `chatStream`, with simple interfaces.
 */
export function simpleCompletionsAPI(
  api: CompletionsAPI, // completionsViaFetch(CONFIG) or (new OpenA().chat.completions)
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
    chatStream: async (
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

/**
 * Makes a completions API using fetch, like OpenAI's .chat.completions.
 * @param config Specifies the URL of the LLM server
 * @returns Object with `create`: equivalent to OpenAI's `.chat.completions`
 */
export function completionsViaFetch(config: Config) {
  return {
    async create(body) {
      if (config.extraStopWords) {
        body.stop = body.stop
          ? typeof body.stop === "string"
            ? [body.stop, ...config.extraStopWords]
            : body.stop.concat(...config.extraStopWords)
          : config.extraStopWords;
      }

      const { result: response, retries } = await retryWithBackoff(async () => {
        const response = await fetch(join(config.url, "/v1/chat/completions"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...AuthHeaders(),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const retry =
            !!config.onError && (await config.onError(response, body.model));

          const error = await response.text();
          console.error({ error });
          throw {
            retry: retry || shouldRetry(response),
            error: new Error(
              `Chat completion failed with code ${response.status}: ${error}`,
            ),
          };
        }
        return response;
      });
      if (retries > 0) {
        console.log("LLM Completion needed retries: ", retries);
      }
      if (!body.stream) {
        const json = (await response.json()) as ChatCompletion;
        if (json.choices[0].message?.content === undefined) {
          throw new Error(
            "Unexpected result from OpenAI: " + JSON.stringify(json),
          );
        }
        return json;
      }
      const stream = response.body;
      if (!stream) throw new Error("No body in response");
      return {
        [Symbol.asyncIterator]: async function* () {
          for await (const data of splitStream(stream)) {
            if (data.startsWith("data:")) {
              const json = data.substring("data:".length).trimStart();
              if (json.startsWith("[DONE]")) {
                return;
              }
              yield JSON.parse(json);
            } else {
              console.debug("Unexpected data:", data);
            }
          }
        },
      };
    },
  } as CompletionsAPI;
}

async function* splitStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
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

/**
 * Embeddings
 */

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

export function simpleEmbeddingsAPI(
  // either embeddingsViaFetch or (new OpenAI().embeddings)
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

/**
 * Helpers
 */

function shouldRetry(response: Response) {
  return (
    response.headers.get("x-should-retry") !== "false" &&
    (response.headers.get("x-should-retry") === "true" ||
      response.status === 408 || // Timeout
      response.status === 409 || // Lock timeout
      response.status === 429 || // Rate limit
      response.status >= 500) // Internal server error
  );
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

const AuthHeaders = (): Record<string, string> =>
  process.env.LLM_API_KEY
    ? { Authorization: "Bearer " + process.env.LLM_API_KEY }
    : {};

type RetryError = { retry: boolean; error: any };

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
): Promise<{ retries: number; result: T; ms: number }> {
  let i = 0;
  for (; i <= RETRY_BACKOFF.length; i++) {
    try {
      const start = Date.now();
      const result = await fn();
      const ms = Date.now() - start;
      return { result, retries: i, ms };
    } catch (e) {
      const retryError = e as RetryError;
      if (i < RETRY_BACKOFF.length) {
        if (retryError.retry) {
          console.log(
            `Attempt ${i + 1} failed, waiting ${RETRY_BACKOFF[i]}ms to retry...`,
            Date.now(),
          );
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              RETRY_BACKOFF[i] + RETRY_JITTER * Math.random(),
            ),
          );
          continue;
        }
      }
      if (retryError.error) throw retryError.error;
      else throw e;
    }
  }
  throw new Error("Unreachable");
}

/**
 * Types to use as our API. Simplified from the OpenAI API.
 */

export interface CompletionsAPI {
  /**
   * Creates a model response for the given chat conversation.
   */
  create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
  create(
    body: ChatCompletionCreateParamsStreaming,
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
}

export interface ChatCompletion {
  id: string;
  choices: Array<{
    finish_reason:
      | "stop"
      | "length"
      | "tool_calls"
      | "content_filter"
      | "function_call";
    index: number;
    logprobs: {
      content: Array<ChatCompletionTokenLogprob> | null;
    } | null;
    message: {
      content: string | null;
      role: "assistant";
      /** @deprecated Deprecated and replaced by `tool_calls` */
      function_call?: {
        arguments: string;
        name: string;
      };
      tool_calls?: Array<ChatCompletionMessageToolCall>;
    };
  }>;
  created: number;
  model: string;
  object: "chat.completion";
  system_fingerprint?: string;
  usage?: CompletionUsage;
}

export interface ChatCompletionChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string | null;
      /** @deprecated: Deprecated and replaced by `tool_calls`. The name and arguments of */
      function_call?: { arguments?: string; name?: string };
      role?: "system" | "user" | "assistant" | "tool";
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          arguments?: string;
          name?: string;
        };
        type?: "function";
      }>;
    };
    finish_reason:
      | "stop"
      | "length"
      | "tool_calls"
      | "content_filter"
      | "function_call"
      | null;
    index: number;
    logprobs?: { content: Array<ChatCompletionTokenLogprob> | null } | null;
  }>;
  created: number;
  model: string;
  object: "chat.completion.chunk";
  system_fingerprint?: string;
  usage?: CompletionUsage;
}

export interface CompletionUsage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionMessageToolCall {
  id: string;
  function: {
    arguments: string;
    name: string;
  };
  type: "function";
}

export interface ChatCompletionTokenLogprob {
  token: string;
  bytes: Array<number> | null;
  logprob: number;
  top_logprobs: Array<{
    token: string;
    bytes: Array<number> | null;
    logprob: number;
  }>;
}

export type ChatCompletionCreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

export interface ChatCompletionCreateParamsBase {
  messages: Array<ChatCompletionMessageParam>;
  model: string;
  /**
  * Number between -2.0 and 2.0. Positive values penalize new tokens based on their
  * existing frequency in the text so far, decreasing the model's likelihood to
  * repeat the same line verbatim.
  *
  * [See more information about frequency and presence penalties.](https://platform.opena
com/docs/guides/text-generation/parameter-details)
  */
  frequency_penalty?: number | null;
  /** @deprecated in favor of `tools`. */
  functions?: Array<{
    /**
     * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain
     * underscores and dashes, with a maximum length of 64.
     */
    name: string;
    /**
     * A description of what the function does, used by the model to choose when and
     * how to call the function.
     */
    description?: string;
    /**
     * The parameters the functions accepts, described as a JSON Schema object. See the
     * [guide](https://platform.openai.com/docs/guides/text-generation/function-calling)
     * for examples, and the
     * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
     * documentation about the format.
     *
     * Omitting `parameters` defines a function with an empty parameter list.
     */
    parameters?: Record<string, unknown>;
  }>;
  /**
   * Modify the likelihood of specified tokens appearing in the completion.
   *
   * Accepts a JSON object that maps tokens (specified by their token ID in the
   * tokenizer) to an associated bias value from -100 to 100. Mathematically, the
   * bias is added to the logits generated by the model prior to sampling. The exact
   * effect will vary per model, but values between -1 and 1 should decrease or
   * increase likelihood of selection; values like -100 or 100 should result in a ban
   * or exclusive selection of the relevant token.
   */
  logit_bias?: Record<string, number> | null;
  logprobs?: boolean | null;
  max_tokens?: number | null;
  n?: number | null;
  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * whether they appear in the text so far, increasing the model's likelihood to
   * talk about new topics.
   *
   * [See more information about frequency and presence penalties.](https://platform.openai.com/docs/guides/text-generation/parameter-details)
   */
  presence_penalty?: number | null;
  response_format?: { type?: "text" | "json_object" };
  seed?: number | null;
  /**
   * Up to 4 sequences where the API will stop generating further tokens.
   */
  stop?: string | null | Array<string>;
  stream?: boolean | null;
  stream_options?: {
    include_usage?: boolean;
  } | null;
  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   *
   * We generally recommend altering this or `top_p` but not both.
   */
  temperature?: number | null;
  /**
   * Controls which (if any) tool is called by the model. `none` means the model will
   * not call any tool and instead generates a message. `auto` means the model can
   * pick between generating a message or calling one or more tools. `required` means
   * the model must call one or more tools. Specifying a particular tool via
   * `{"type": "function", "function": {"name": "my_function"}}` forces the model to
   * call that tool.
   *
   * `none` is the default when no tools are present. `auto` is the default if tools
   * are present.
   */
  tool_choice?:
    | "none" // the model will not call any tool and instead generates a message.
    | "auto" // the model can pick between generating a message or calling one or more tools.
    | "required" // the model must call one or more tools.
    | { function: { name: string }; type: "function" }; // forces the tool.
  /**
   * A list of tools the model may call. Currently, only functions are supported as a
   * tool. Use this to provide a list of functions the model may generate JSON inputs
   * for. A max of 128 functions are supported.
   */
  tools?: Array<{
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
    type: "function";
  }>;
  top_logprobs?: number | null;
  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p?: number | null;
  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids).
   */
  user?: string;
}

export type ChatCompletionMessageParam =
  | {
      role: "system";
      content: string;
      name?: string;
    }
  | {
      role: "user";
      content:
        | string
        | Array<
            | {
                text: string;
                type: "text";
              }
            | {
                image_url: { url: string; detail?: "auto" | "low" | "high" };
                type: "image_url";
              }
          >;
      name?: string;
    }
  | {
      role: "assistant";
      content?: string | null;
      name?: string;
      tool_calls?: Array<ChatCompletionMessageToolCall>;
    }
  | {
      content: string;
      role: "tool";
      tool_call_id: string;
    };

export interface ChatCompletionCreateParamsNonStreaming
  extends ChatCompletionCreateParamsBase {
  stream?: false | null;
}
export interface ChatCompletionCreateParamsStreaming
  extends ChatCompletionCreateParamsBase {
  stream: true;
}

/** Embeddings */
export interface EmbeddingsAPI {
  /**
   * Creates an embedding vector representing the input text.
   */
  create(body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse>;
}

export interface CreateEmbeddingResponse {
  data: Array<Embedding>;
  model: string;
  object: "list";
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface Embedding {
  embedding: Array<number>;
  index: number;
  object: "embedding";
}

export interface EmbeddingCreateParams {
  /**
   * Input text to embed, encoded as a string or array of tokens. To embed multiple
   * inputs in a single request, pass an array of strings or array of token arrays.
   * The input must not exceed the max input tokens for the model (8192 tokens for
   * `text-embedding-ada-002`), cannot be an empty string, and any array must be 2048
   * dimensions or less.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken)
   * for counting tokens.
   */
  input: string | Array<string> | Array<number> | Array<Array<number>>;
  model: string;
  dimensions?: number;
  encoding_format?: "float" | "base64";
  user?: string;
}
