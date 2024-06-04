// That's right! No imports and no dependencies 🤯

export const LLM_CONFIG = {
  /* Ollama (local) config:
   */
  ollama: true,
  url: "http://127.0.0.1:11434",
  chatModel: "llama3",
  embeddingModel: "mxbai-embed-large",
  embeddingDimension: 1024,
  // embeddingModel: 'llama3',
  // embeddingDimension: 4096,

  /* Together.ai config:
  ollama: false,
  url: 'https://api.together.xyz',
  chatModel: 'meta-llama/Llama-3-8b-chat-hf',
  embeddingModel: 'togethercomputer/m2-bert-80M-8k-retrieval',
  embeddingDimension: 768,
   */

  /* OpenAI config:
  ollama: false,
  url: 'https://api.openai.com',
  chatModel: 'gpt-3.5-turbo-16k',
  embeddingModel: 'text-embedding-ada-002',
  embeddingDimension: 1536,
   */
};

function apiUrl(path: string) {
  const host = process.env.LLM_API_URL ?? LLM_CONFIG.url;
  if (host.endsWith("/") && path.startsWith("/")) {
    return host + path.slice(1);
  } else if (!host.endsWith("/") && !path.startsWith("/")) {
    return host + "/" + path;
  } else {
    return host + path;
  }
}

const AuthHeaders = (): Record<string, string> =>
  process.env.LLM_API_KEY
    ? { Authorization: "Bearer " + process.env.LLM_API_KEY }
    : {};

// Overload for non-streaming
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, "model"> & {
    model?: CreateChatCompletionRequest["model"];
  } & {
    stream?: false | null | undefined;
  }
): Promise<{ content: string; retries: number; ms: number }>;
// Overload for streaming
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, "model"> & {
    model?: CreateChatCompletionRequest["model"];
  } & {
    stream?: true;
  }
): Promise<{ content: ChatCompletionContent; retries: number; ms: number }>;
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, "model"> & {
    model?: CreateChatCompletionRequest["model"];
  }
) {
  assertApiKey();
  body.model = body.model ?? process.env.LLM_MODEL ?? LLM_CONFIG.chatModel;
  const stopWords = body.stop
    ? typeof body.stop === "string"
      ? [body.stop]
      : body.stop
    : [];
  if (LLM_CONFIG.ollama) stopWords.push("<|eot_id|>");
  console.log(body);
  const {
    result: content,
    retries,
    ms,
  } = await retryWithBackoff(async () => {
    const result = await fetch(apiUrl("/v1/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...AuthHeaders(),
      },

      body: JSON.stringify(body),
    });
    if (!result.ok) {
      const error = await result.text();
      console.error({ error });
      if (result.status === 404 && LLM_CONFIG.ollama) {
        await tryPullOllama(body.model!, error);
      }
      throw {
        retry: result.status === 429 || result.status >= 500,
        error: new Error(
          `Chat completion failed with code ${result.status}: ${error}`
        ),
      };
    }
    if (body.stream) {
      return new ChatCompletionContent(result.body!, stopWords);
    } else {
      const json = (await result.json()) as CreateChatCompletionResponse;
      const content = json.choices[0].message?.content;
      if (content === undefined) {
        throw new Error(
          "Unexpected result from OpenAI: " + JSON.stringify(json)
        );
      }
      console.log(content);
      return content;
    }
  });

  return {
    content,
    retries,
    ms,
  };
}

export async function pullOllama(model: string) {
  return fetch(apiUrl("/api/pull"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: model }),
  });
}

export async function tryPullOllama(model: string, error: string) {
  if (error.includes("try pulling")) {
    console.error("Model not found, pulling from Ollama");
    const pullResp = await pullOllama(model);
    if (!pullResp.ok) {
      throw new Error(
        `Failed to pull model: ${pullResp.status}: ${pullResp.statusText}`
      );
    } else {
      throw {
        retry: true,
        error: `Dynamically pulled model. Trying again.`,
      };
    }
  }
}

export async function fetchEmbeddingBatch(texts: string[], model?: string) {
  if (LLM_CONFIG.ollama) {
    return {
      ollama: true as const,
      embeddings: await Promise.all(
        texts.map(async (t) => (await ollamaFetchEmbedding(t, model)).embedding)
      ),
    };
  }
  assertApiKey();
  const {
    result: json,
    retries,
    ms,
  } = await retryWithBackoff(async () => {
    const result = await fetch(apiUrl("/v1/embeddings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...AuthHeaders(),
      },

      body: JSON.stringify({
        model: model ?? LLM_CONFIG.embeddingModel,
        input: texts.map((text) => text.replace(/\n/g, " ")),
      }),
    });
    if (!result.ok) {
      throw {
        retry: result.status === 429 || result.status >= 500,
        error: new Error(
          `Embedding failed with code ${result.status}: ${await result.text()}`
        ),
      };
    }
    return (await result.json()) as CreateEmbeddingResponse;
  });
  if (json.data.length !== texts.length) {
    console.error(json);
    throw new Error("Unexpected number of embeddings");
  }
  const allembeddings = json.data;
  allembeddings.sort((a, b) => a.index - b.index);
  return {
    ollama: false as const,
    embeddings: allembeddings.map(({ embedding }) => embedding),
    usage: json.usage?.total_tokens,
    retries,
    ms,
  };
}

export async function fetchEmbedding(text: string, model?: string) {
  const { embeddings, ...stats } = await fetchEmbeddingBatch([text], model);
  return { embedding: embeddings[0], ...stats };
}

export async function fetchModeration(content: string) {
  assertApiKey();
  const { result: flagged } = await retryWithBackoff(async () => {
    const result = await fetch(apiUrl("/v1/moderations"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...AuthHeaders(),
      },

      body: JSON.stringify({
        input: content,
      }),
    });
    if (!result.ok) {
      throw {
        retry: result.status === 429 || result.status >= 500,
        error: new Error(
          `Embedding failed with code ${result.status}: ${await result.text()}`
        ),
      };
    }
    return (await result.json()) as { results: { flagged: boolean }[] };
  });
  return flagged;
}

export function assertApiKey() {
  if (!LLM_CONFIG.ollama && !process.env.LLM_API_KEY) {
    throw new Error(
      "\n  Missing LLM_API_KEY in environment variables.\n\n" +
        (LLM_CONFIG.ollama ? "just" : "npx") +
        " convex env set LLM_API_KEY 'your-key'"
    );
  }
}

// Retry after this much time, based on the retry number.
const RETRY_BACKOFF = [1000, 10_000, 20_000]; // In ms
const RETRY_JITTER = 100; // In ms
type RetryError = { retry: boolean; error: any };

export async function retryWithBackoff<T>(
  fn: () => Promise<T>
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
            Date.now()
          );
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BACKOFF[i] + RETRY_JITTER * Math.random())
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

// Lifted from openai's package
export interface LLMMessage {
  /**
   * The contents of the message. `content` is required for all messages, and may be
   * null for assistant messages with function calls.
   */
  content: string | null;

  /**
   * The role of the messages author. One of `system`, `user`, `assistant`, or
   * `function`.
   */
  role: "system" | "user" | "assistant" | "function";

  /**
   * The name of the author of this message. `name` is required if role is
   * `function`, and it should be the name of the function whose response is in the
   * `content`. May contain a-z, A-Z, 0-9, and underscores, with a maximum length of
   * 64 characters.
   */
  name?: string;

  /**
   * The name and arguments of a function that should be called, as generated by the model.
   */
  function_call?: {
    // The name of the function to call.
    name: string;
    /**
     * The arguments to call the function with, as generated by the model in
     * JSON format. Note that the model does not always generate valid JSON,
     * and may hallucinate parameters not defined by your function schema.
     * Validate the arguments in your code before calling your function.
     */
    arguments: string;
  };
}

// Non-streaming chat completion response
interface CreateChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index?: number;
    message?: {
      role: "system" | "user" | "assistant";
      content: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    completion_tokens: number;

    prompt_tokens: number;

    total_tokens: number;
  };
}

interface CreateEmbeddingResponse {
  data: {
    index: number;
    object: string;
    embedding: number[];
  }[];
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface CreateChatCompletionRequest {
  /**
   * ID of the model to use.
   * @type {string}
   * @memberof CreateChatCompletionRequest
   */
  model: string;
  // | 'gpt-4'
  // | 'gpt-4-0613'
  // | 'gpt-4-32k'
  // | 'gpt-4-32k-0613'
  // | 'gpt-3.5-turbo'
  // | 'gpt-3.5-turbo-0613'
  // | 'gpt-3.5-turbo-16k' // <- our default
  // | 'gpt-3.5-turbo-16k-0613';
  /**
   * The messages to generate chat completions for, in the chat format:
   * https://platform.openai.com/docs/guides/chat/introduction
   * @type {Array<ChatCompletionRequestMessage>}
   * @memberof CreateChatCompletionRequest
   */
  messages: LLMMessage[];
  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.  We generally recommend altering this or `top_p` but not both.
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  temperature?: number | null;
  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.  We generally recommend altering this or `temperature` but not both.
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  top_p?: number | null;
  /**
   * How many chat completion choices to generate for each input message.
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  n?: number | null;
  /**
   * If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]` message.
   * @type {boolean}
   * @memberof CreateChatCompletionRequest
   */
  stream?: boolean | null;
  /**
   *
   * @type {CreateChatCompletionRequestStop}
   * @memberof CreateChatCompletionRequest
   */
  stop?: Array<string> | string;
  /**
   * The maximum number of tokens allowed for the generated answer. By default,
   * the number of tokens the model can return will be (4096 - prompt tokens).
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  max_tokens?: number;
  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * whether they appear in the text so far, increasing the model\'s likelihood
   * to talk about new topics. See more information about frequency and
   * presence penalties:
   * https://platform.openai.com/docs/api-reference/parameter-details
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  presence_penalty?: number | null;
  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * their existing frequency in the text so far, decreasing the model\'s
   * likelihood to repeat the same line verbatim. See more information about
   * presence penalties:
   * https://platform.openai.com/docs/api-reference/parameter-details
   * @type {number}
   * @memberof CreateChatCompletionRequest
   */
  frequency_penalty?: number | null;
  /**
   * Modify the likelihood of specified tokens appearing in the completion.
   * Accepts a json object that maps tokens (specified by their token ID in the
   * tokenizer) to an associated bias value from -100 to 100. Mathematically,
   * the bias is added to the logits generated by the model prior to sampling.
   * The exact effect will vary per model, but values between -1 and 1 should
   * decrease or increase likelihood of selection; values like -100 or 100
   * should result in a ban or exclusive selection of the relevant token.
   * @type {object}
   * @memberof CreateChatCompletionRequest
   */
  logit_bias?: object | null;
  /**
   * A unique identifier representing your end-user, which can help OpenAI to
   * monitor and detect abuse. Learn more:
   * https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids
   * @type {string}
   * @memberof CreateChatCompletionRequest
   */
  user?: string;
  tools?: {
    // The type of the tool. Currently, only function is supported.
    type: "function";
    function: {
      /**
       * The name of the function to be called. Must be a-z, A-Z, 0-9, or
       * contain underscores and dashes, with a maximum length of 64.
       */
      name: string;
      /**
       * A description of what the function does, used by the model to choose
       * when and how to call the function.
       */
      description?: string;
      /**
       * The parameters the functions accepts, described as a JSON Schema
       * object. See the guide[1] for examples, and the JSON Schema reference[2]
       * for documentation about the format.
       * [1]: https://platform.openai.com/docs/guides/gpt/function-calling
       * [2]: https://json-schema.org/understanding-json-schema/
       * To describe a function that accepts no parameters, provide the value
       * {"type": "object", "properties": {}}.
       */
      parameters: object;
    };
  }[];
  /**
   * Controls which (if any) function is called by the model. `none` means the
   * model will not call a function and instead generates a message.
   * `auto` means the model can pick between generating a message or calling a
   * function. Specifying a particular function via
   * {"type: "function", "function": {"name": "my_function"}} forces the model
   * to call that function.
   *
   * `none` is the default when no functions are present.
   * `auto` is the default if functions are present.
   */
  tool_choice?:
    | "none" // none means the model will not call a function and instead generates a message.
    | "auto" // auto means the model can pick between generating a message or calling a function.
    // Specifies a tool the model should use. Use to force the model to call
    // a specific function.
    | {
        // The type of the tool. Currently, only function is supported.
        type: "function";
        function: { name: string };
      };
  // Replaced by "tools"
  // functions?: {
  //   /**
  //    * The name of the function to be called. Must be a-z, A-Z, 0-9, or
  //    * contain underscores and dashes, with a maximum length of 64.
  //    */
  //   name: string;
  //   /**
  //    * A description of what the function does, used by the model to choose
  //    * when and how to call the function.
  //    */
  //   description?: string;
  //   /**
  //    * The parameters the functions accepts, described as a JSON Schema
  //    * object. See the guide[1] for examples, and the JSON Schema reference[2]
  //    * for documentation about the format.
  //    * [1]: https://platform.openai.com/docs/guides/gpt/function-calling
  //    * [2]: https://json-schema.org/understanding-json-schema/
  //    * To describe a function that accepts no parameters, provide the value
  //    * {"type": "object", "properties": {}}.
  //    */
  //   parameters: object;
  // }[];
  // /**
  //  * Controls how the model responds to function calls. "none" means the model
  //  * does not call a function, and responds to the end-user. "auto" means the
  //  * model can pick between an end-user or calling a function. Specifying a
  //  * particular function via {"name":\ "my_function"} forces the model to call
  //  *  that function.
  //  * - "none" is the default when no functions are present.
  //  * - "auto" is the default if functions are present.
  //  */
  // function_call?: 'none' | 'auto' | { name: string };
  /**
   * An object specifying the format that the model must output.
   *
   * Setting to { "type": "json_object" } enables JSON mode, which guarantees
   * the message the model generates is valid JSON.
   * *Important*: when using JSON mode, you must also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model
   * may generate an unending stream of whitespace until the generation reaches
   * the token limit, resulting in a long-running and seemingly "stuck" request.
   * Also note that the message content may be partially cut off if
   * finish_reason="length", which indicates the generation exceeded max_tokens
   * or the conversation exceeded the max context length.
   */
  response_format?: { type: "text" | "json_object" };
}

// Checks whether a suffix of s1 is a prefix of s2. For example,
// ('Hello', 'Kira:') -> false
// ('Hello Kira', 'Kira:') -> true
const suffixOverlapsPrefix = (s1: string, s2: string) => {
  for (let i = 1; i <= Math.min(s1.length, s2.length); i++) {
    const suffix = s1.substring(s1.length - i);
    const prefix = s2.substring(0, i);
    if (suffix === prefix) {
      return true;
    }
  }
  return false;
};

export class ChatCompletionContent {
  private readonly body: ReadableStream<Uint8Array>;
  private readonly stopWords: string[];

  constructor(body: ReadableStream<Uint8Array>, stopWords: string[]) {
    this.body = body;
    this.stopWords = stopWords;
  }

  async *readInner() {
    for await (const data of this.splitStream(this.body)) {
      if (data.startsWith("data: ")) {
        try {
          const json = JSON.parse(data.substring("data: ".length)) as {
            choices: { delta: { content?: string } }[];
          };
          if (json.choices[0].delta.content) {
            yield json.choices[0].delta.content;
          }
        } catch (e) {
          // e.g. the last chunk is [DONE] which is not valid JSON.
        }
      }
    }
  }

  // stop words in OpenAI api don't always work.
  // So we have to truncate on our side.
  async *read() {
    let lastFragment = "";
    for await (const data of this.readInner()) {
      lastFragment += data;
      let hasOverlap = false;
      for (const stopWord of this.stopWords) {
        const idx = lastFragment.indexOf(stopWord);
        if (idx >= 0) {
          yield lastFragment.substring(0, idx);
          return;
        }
        if (suffixOverlapsPrefix(lastFragment, stopWord)) {
          hasOverlap = true;
        }
      }
      if (hasOverlap) continue;
      yield lastFragment;
      lastFragment = "";
    }
    yield lastFragment;
  }

  async readAll() {
    let allContent = "";
    for await (const chunk of this.read()) {
      allContent += chunk;
    }
    return allContent;
  }

  async *splitStream(stream: ReadableStream<Uint8Array>) {
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
}

export async function ollamaFetchEmbedding(text: string, embedModel?: string) {
  const { result } = await retryWithBackoff(async () => {
    const model = embedModel ?? LLM_CONFIG.embeddingModel;
    const resp = await fetch(apiUrl("/api/embeddings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (resp.status === 404) {
      const error = await resp.text();
      await tryPullOllama(model, error);
      throw new Error(`Failed to fetch embeddings: ${resp.status}`);
    }
    return (await resp.json()).embedding as number[];
  });
  return { embedding: result };
}

function isStreaming(
  params: ChatCompletionCreateParams,
): params is ChatCompletionCreateParamsStreaming {
  return !!params.stream;
}

export const chatCompletions = {
  async create(body) {
    // body.model = body.model ?? process.env.LLM_MODEL ?? LLM_CONFIG.chatModel;
    const stopWords = body.stop
      ? typeof body.stop === "string"
        ? [body.stop]
        : body.stop
      : [];
    if (LLM_CONFIG.ollama) stopWords.push("<|eot_id|>");

    const { result, retries, ms } = await retryWithBackoff(async () => {
      const result = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...AuthHeaders(),
        },

        body: JSON.stringify(body),
      });
      if (!result.ok) {
        const error = await result.text();
        console.error({ error });
        if (result.status === 404 && LLM_CONFIG.ollama) {
          await tryPullOllama(body.model, error);
        }
        throw {
          retry:
            result.headers.get("x-should-retry") !== "false" &&
            (result.headers.get("x-should-retry") === "true" ||
              result.status === 408 || // Timeout
              result.status === 409 || // Lock timeout
              result.status === 429 || // Rate limit
              result.status >= 500), // Internal server error
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
    if (isStreaming(body)) {
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
} as Completions;

async function* splitStream(stream: ReadableStream<Uint8Array>) {
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

/* eslint-disable @typescript-eslint/no-namespace */

/**
 * Types to use as our API. Changes are marked with // CHANGE
 */

export interface Completions {
  /**
   * Creates a model response for the given chat conversation.
   */
  create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
  create(
    body: ChatCompletionCreateParamsStreaming,
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  // CHANGE
  // create(
  //   body: ChatCompletionCreateParamsBase,
  // ): Promise<AsyncIterable<ChatCompletionChunk> | ChatCompletion>;
  // create(
  //   body: ChatCompletionCreateParams,
  // ): Promise<ChatCompletion> | Promise<AsyncIterable<ChatCompletionChunk>>;
}

/**
 * Represents a chat completion response returned by model, based on the provided
 * input.
 */
export interface ChatCompletion {
  /**
   * A unique identifier for the chat completion.
   */
  id: string;

  /**
   * A list of chat completion choices. Can be more than one if `n` is greater
   * than 1.
   */
  choices: Array<ChatCompletion.Choice>;

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created.
   */
  created: number;

  /**
   * The model used for the chat completion.
   */
  model: string; // CHANGE

  /**
   * The object type, which is always `chat.completion`.
   */
  object: "chat.completion";

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   *
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;

  /**
   * Usage statistics for the completion request.
   */
  usage?: CompletionUsage;
}

/**
 * Usage statistics for the completion request.
 */
export interface CompletionUsage {
  /**
   * Number of tokens in the generated completion.
   */
  completion_tokens: number;

  /**
   * Number of tokens in the prompt.
   */
  prompt_tokens: number;

  /**
   * Total number of tokens used in the request (prompt + completion).
   */
  total_tokens: number;
}

export namespace ChatCompletion {
  export interface Choice {
    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, `tool_calls` if the
     * model called a tool, or `function_call` (deprecated) if the model called a
     * function.
     */
    finish_reason:
      | "abort" // CHANGE
      | "stop"
      | "length"
      | "tool_calls"
      | "content_filter"
      | "function_call";

    /**
     * The index of the choice in the list of choices.
     */
    index: number;

    /**
     * Log probability information for the choice.
     */
    logprobs: Choice.Logprobs | null;

    /**
     * A chat completion message generated by the model.
     */
    message: ChatCompletionMessage;
  }

  export namespace Choice {
    /**
     * Log probability information for the choice.
     */
    export interface Logprobs {
      /**
       * A list of message content tokens with log probability information.
       */
      content: Array<ChatCompletionTokenLogprob> | null;
    }
  }
}

export interface ChatCompletionAssistantMessageParam {
  /**
   * The role of the messages author, in this case `assistant`.
   */
  role: "assistant";

  /**
   * The contents of the assistant message. Required unless `tool_calls` or
   * `function_call` is specified.
   */
  content?: string | null;

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;

  /**
   * The tool calls generated by the model, such as function calls.
   */
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

/**
 * Represents a streamed chunk of a chat completion response returned by model,
 * based on the provided input.
 */
export interface ChatCompletionChunk {
  /**
   * A unique identifier for the chat completion. Each chunk has the same ID.
   */
  id: string;

  /**
   * A list of chat completion choices. Can contain more than one elements if `n` is
   * greater than 1. Can also be empty for the last chunk if you set
   * `stream_options: {"include_usage": true}`.
   */
  choices: Array<ChatCompletionChunk.Choice>;

  /**
   * The Unix timestamp (in seconds) of when the chat completion was created. Each
   * chunk has the same timestamp.
   */
  created: number;

  /**
   * The model to generate the completion.
   */
  model: string;

  /**
   * The object type, which is always `chat.completion.chunk`.
   */
  object: "chat.completion.chunk";

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;

  /**
   * An optional field that will only be present when you set
   * `stream_options: {"include_usage": true}` in your request. When present, it
   * contains a null value except for the last chunk which contains the token usage
   * statistics for the entire request.
   */
  usage?: CompletionUsage;
}

export namespace ChatCompletionChunk {
  export interface Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    delta: Choice.Delta;

    /**
     * The reason the model stopped generating tokens. This will be `stop` if the model
     * hit a natural stop point or a provided stop sequence, `length` if the maximum
     * number of tokens specified in the request was reached, `content_filter` if
     * content was omitted due to a flag from our content filters, `tool_calls` if the
     * model called a tool, or `function_call` (deprecated) if the model called a
     * function.
     */
    finish_reason:
      | "stop"
      | "length"
      | "tool_calls"
      | "content_filter"
      | "function_call"
      | null;

    /**
     * The index of the choice in the list of choices.
     */
    index: number;

    /**
     * Log probability information for the choice.
     */
    logprobs?: Choice.Logprobs | null;
  }

  export namespace Choice {
    /**
     * A chat completion delta generated by streamed model responses.
     */
    export interface Delta {
      /**
       * The contents of the chunk message.
       */
      content?: string | null;

      /**
       * @deprecated: Deprecated and replaced by `tool_calls`. The name and arguments of
       * a function that should be called, as generated by the model.
       */
      function_call?: Delta.FunctionCall;

      /**
       * The role of the author of this message.
       */
      role?: "system" | "user" | "assistant" | "tool";

      tool_calls?: Array<Delta.ToolCall>;
    }

    export namespace Delta {
      /**
       * @deprecated: Deprecated and replaced by `tool_calls`. The name and arguments of
       * a function that should be called, as generated by the model.
       */
      export interface FunctionCall {
        /**
         * The arguments to call the function with, as generated by the model in JSON
         * format. Note that the model does not always generate valid JSON, and may
         * hallucinate parameters not defined by your function schema. Validate the
         * arguments in your code before calling your function.
         */
        arguments?: string;

        /**
         * The name of the function to call.
         */
        name?: string;
      }

      export interface ToolCall {
        index: number;

        /**
         * The ID of the tool call.
         */
        id?: string;

        function?: ToolCall.Function;

        /**
         * The type of the tool. Currently, only `function` is supported.
         */
        type?: "function";
      }

      export namespace ToolCall {
        export interface Function {
          /**
           * The arguments to call the function with, as generated by the model in JSON
           * format. Note that the model does not always generate valid JSON, and may
           * hallucinate parameters not defined by your function schema. Validate the
           * arguments in your code before calling your function.
           */
          arguments?: string;

          /**
           * The name of the function to call.
           */
          name?: string;
        }
      }
    }

    /**
     * Log probability information for the choice.
     */
    export interface Logprobs {
      /**
       * A list of message content tokens with log probability information.
       */
      content: Array<ChatCompletionTokenLogprob> | null;
    }
  }
}

export type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage;

export interface ChatCompletionContentPartImage {
  image_url: ChatCompletionContentPartImage.ImageURL;

  /**
   * The type of the content part.
   */
  type: "image_url";
}

export namespace ChatCompletionContentPartImage {
  export interface ImageURL {
    /**
     * Either a URL of the image or the base64 encoded image data.
     */
    url: string;

    /**
     * Specifies the detail level of the image. Learn more in the
     * [Vision guide](https://platform.openai.com/docs/guides/vision/low-or-high-fidelity-image-understanding).
     */
    detail?: "auto" | "low" | "high";
  }
}

export interface ChatCompletionContentPartText {
  /**
   * The text content.
   */
  text: string;

  /**
   * The type of the content part.
   */
  type: "text";
}

/**
 * Specifying a particular function via `{"name": "my_function"}` forces the model
 * to call that function.
 */
export interface ChatCompletionFunctionCallOption {
  /**
   * The name of the function to call.
   */
  name: string;
}

/**
 * @deprecated
 */
export interface ChatCompletionFunctionMessageParam {
  /**
   * The contents of the function message.
   */
  content: string | null;

  /**
   * The name of the function to call.
   */
  name: string;

  /**
   * The role of the messages author, in this case `function`.
   */
  role: "function";
}

/**
 * A chat completion message generated by the model.
 */
export interface ChatCompletionMessage {
  /**
   * The contents of the message.
   */
  content: string | null;

  /**
   * The role of the author of this message.
   */
  role: "assistant";

  /**
   * @deprecated: Deprecated and replaced by `tool_calls`. The name and arguments of
   * a function that should be called, as generated by the model.
   */
  function_call?: ChatCompletionMessage.FunctionCall;

  /**
   * The tool calls generated by the model, such as function calls.
   */
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

export namespace ChatCompletionMessage {
  /**
   * @deprecated: Deprecated and replaced by `tool_calls`. The name and arguments of
   * a function that should be called, as generated by the model.
   */
  export interface FunctionCall {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;

    /**
     * The name of the function to call.
     */
    name: string;
  }
}

export type ChatCompletionMessageParam =
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;

export interface ChatCompletionMessageToolCall {
  /**
   * The ID of the tool call.
   */
  id: string;

  /**
   * The function that the model called.
   */
  function: ChatCompletionMessageToolCall.Function;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: "function";
}

export namespace ChatCompletionMessageToolCall {
  /**
   * The function that the model called.
   */
  export interface Function {
    /**
     * The arguments to call the function with, as generated by the model in JSON
     * format. Note that the model does not always generate valid JSON, and may
     * hallucinate parameters not defined by your function schema. Validate the
     * arguments in your code before calling your function.
     */
    arguments: string;

    /**
     * The name of the function to call.
     */
    name: string;
  }
}

/**
 * Specifies a tool the model should use. Use to force the model to call a specific
 * function.
 */
export interface ChatCompletionNamedToolChoice {
  function: ChatCompletionNamedToolChoice.Function;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: "function";
}

export namespace ChatCompletionNamedToolChoice {
  export interface Function {
    /**
     * The name of the function to call.
     */
    name: string;
  }
}

/**
 * The role of the author of a message
 */
export type ChatCompletionRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "function";

/**
 * Options for streaming response. Only set this when you set `stream: true`.
 */
export interface ChatCompletionStreamOptions {
  /**
   * If set, an additional chunk will be streamed before the `data: [DONE]` message.
   * The `usage` field on this chunk shows the token usage statistics for the entire
   * request, and the `choices` field will always be an empty array. All other chunks
   * will also include a `usage` field, but with a null value.
   */
  include_usage?: boolean;
}

export interface ChatCompletionSystemMessageParam {
  /**
   * The contents of the system message.
   */
  content: string;

  /**
   * The role of the messages author, in this case `system`.
   */
  role: "system";

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;
}

export interface ChatCompletionTokenLogprob {
  /**
   * The token.
   */
  token: string;

  /**
   * A list of integers representing the UTF-8 bytes representation of the token.
   * Useful in instances where characters are represented by multiple tokens and
   * their byte representations must be combined to generate the correct text
   * representation. Can be `null` if there is no bytes representation for the token.
   */
  bytes: Array<number> | null;

  /**
   * The log probability of this token, if it is within the top 20 most likely
   * tokens. Otherwise, the value `-9999.0` is used to signify that the token is very
   * unlikely.
   */
  logprob: number;

  /**
   * List of the most likely tokens and their log probability, at this token
   * position. In rare cases, there may be fewer than the number of requested
   * `top_logprobs` returned.
   */
  top_logprobs: Array<ChatCompletionTokenLogprob.TopLogprob>;
}

export namespace ChatCompletionTokenLogprob {
  export interface TopLogprob {
    /**
     * The token.
     */
    token: string;

    /**
     * A list of integers representing the UTF-8 bytes representation of the token.
     * Useful in instances where characters are represented by multiple tokens and
     * their byte representations must be combined to generate the correct text
     * representation. Can be `null` if there is no bytes representation for the token.
     */
    bytes: Array<number> | null;

    /**
     * The log probability of this token, if it is within the top 20 most likely
     * tokens. Otherwise, the value `-9999.0` is used to signify that the token is very
     * unlikely.
     */
    logprob: number;
  }
}

export interface ChatCompletionTool {
  function: FunctionDefinition;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: "function";
}

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
export type ChatCompletionToolChoiceOption =
  | "none"
  | "auto"
  // | "required" // CHANGE
  | ChatCompletionNamedToolChoice;

export interface ChatCompletionToolMessageParam {
  /**
   * The contents of the tool message.
   */
  content: string;

  /**
   * The role of the messages author, in this case `tool`.
   */
  role: "tool";

  /**
   * Tool call that this message is responding to.
   */
  tool_call_id: string;
}

export interface ChatCompletionUserMessageParam {
  /**
   * The contents of the user message.
   */
  content: string | Array<ChatCompletionContentPart>;

  /**
   * The role of the messages author, in this case `user`.
   */
  role: "user";

  /**
   * An optional name for the participant. Provides the model information to
   * differentiate between participants of the same role.
   */
  name?: string;
}

export type ChatCompletionCreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

export interface ChatCompletionCreateParamsBase {
  /**
   * A list of messages comprising the conversation so far.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_format_inputs_to_chatgpt_models).
   */
  messages: Array<ChatCompletionMessageParam>;

  /**
   * ID of the model to use. See the
   * [model endpoint compatibility](https://platform.openai.com/docs/models/model-endpoint-compatibility)
   * table for details on which models work with the Chat API.
   */
  model: string;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on their
   * existing frequency in the text so far, decreasing the model's likelihood to
   * repeat the same line verbatim.
   *
   * [See more information about frequency and presence penalties.](https://platform.openai.com/docs/guides/text-generation/parameter-details)
   */
  frequency_penalty?: number | null;

  /**
   * Deprecated in favor of `tools`.
   *
   * A list of functions the model may generate JSON inputs for.
   */
  functions?: Array<ChatCompletionCreateParams.Function>;

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

  /**
   * Whether to return log probabilities of the output tokens or not. If true,
   * returns the log probabilities of each output token returned in the `content` of
   * `message`.
   */
  logprobs?: boolean | null;

  /**
   * The maximum number of [tokens](/tokenizer) that can be generated in the chat
   * completion.
   *
   * The total length of input tokens and generated tokens is limited by the model's
   * context length.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken)
   * for counting tokens.
   */
  max_tokens?: number | null;

  /**
   * How many chat completion choices to generate for each input message. Note that
   * you will be charged based on the number of generated tokens across all of the
   * choices. Keep `n` as `1` to minimize costs.
   */
  n?: number | null;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * whether they appear in the text so far, increasing the model's likelihood to
   * talk about new topics.
   *
   * [See more information about frequency and presence penalties.](https://platform.openai.com/docs/guides/text-generation/parameter-details)
   */
  presence_penalty?: number | null;

  /**
   * An object specifying the format that the model must output. Compatible with
   * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-and-gpt-4-turbo) and
   * all GPT-3.5 Turbo models newer than `gpt-3.5-turbo-1106`.
   *
   * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
   * message the model generates is valid JSON.
   *
   * **Important:** when using JSON mode, you **must** also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model may
   * generate an unending stream of whitespace until the generation reaches the token
   * limit, resulting in a long-running and seemingly "stuck" request. Also note that
   * the message content may be partially cut off if `finish_reason="length"`, which
   * indicates the generation exceeded `max_tokens` or the conversation exceeded the
   * max context length.
   */
  response_format?: ChatCompletionCreateParams.ResponseFormat;

  /**
   * This feature is in Beta. If specified, our system will make a best effort to
   * sample deterministically, such that repeated requests with the same `seed` and
   * parameters should return the same result. Determinism is not guaranteed, and you
   * should refer to the `system_fingerprint` response parameter to monitor changes
   * in the backend.
   */
  seed?: number | null;

  /**
   * Up to 4 sequences where the API will stop generating further tokens.
   */
  stop?: string | null | Array<string>;

  /**
   * If set, partial message deltas will be sent, like in ChatGPT. Tokens will be
   * sent as data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream?: boolean | null;

  /**
   * Options for streaming response. Only set this when you set `stream: true`.
   */
  stream_options?: ChatCompletionStreamOptions | null;

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
  tool_choice?: ChatCompletionToolChoiceOption;

  /**
   * A list of tools the model may call. Currently, only functions are supported as a
   * tool. Use this to provide a list of functions the model may generate JSON inputs
   * for. A max of 128 functions are supported.
   */
  tools?: Array<ChatCompletionTool>;

  /**
   * An integer between 0 and 20 specifying the number of most likely tokens to
   * return at each token position, each with an associated log probability.
   * `logprobs` must be set to `true` if this parameter is used.
   */
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

  // CHANGE
  max_gen_len?: number;
}

export namespace ChatCompletionCreateParams {
  /**
   * @deprecated
   */
  export interface Function {
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
    parameters?: FunctionParameters;
  }

  /**
   * An object specifying the format that the model must output. Compatible with
   * [GPT-4 Turbo](https://platform.openai.com/docs/models/gpt-4-and-gpt-4-turbo) and
   * all GPT-3.5 Turbo models newer than `gpt-3.5-turbo-1106`.
   *
   * Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the
   * message the model generates is valid JSON.
   *
   * **Important:** when using JSON mode, you **must** also instruct the model to
   * produce JSON yourself via a system or user message. Without this, the model may
   * generate an unending stream of whitespace until the generation reaches the token
   * limit, resulting in a long-running and seemingly "stuck" request. Also note that
   * the message content may be partially cut off if `finish_reason="length"`, which
   * indicates the generation exceeded `max_tokens` or the conversation exceeded the
   * max context length.
   */
  export interface ResponseFormat {
    /**
     * Must be one of `text` or `json_object`.
     */
    type?: "text" | "json_object";
  }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

export interface ErrorObject {
  code: string | null;

  message: string;

  param: string | null;

  type: string;
}

export interface FunctionDefinition {
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
  parameters?: FunctionParameters;
}

/**
 * The parameters the functions accepts, described as a JSON Schema object. See the
 * [guide](https://platform.openai.com/docs/guides/text-generation/function-calling)
 * for examples, and the
 * [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
 * documentation about the format.
 *
 * Omitting `parameters` defines a function with an empty parameter list.
 */
export type FunctionParameters = Record<string, unknown>;

export interface ChatCompletionCreateParamsNonStreaming
  extends ChatCompletionCreateParamsBase {
  /**
   * If set, partial message deltas will be sent, like in ChatGPT. Tokens will be
   * sent as data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream?: false | null;
}

/**
 * @deprecated Use ChatCompletionCreateParamsNonStreaming instead
 */
export type CompletionCreateParamsNonStreaming =
  ChatCompletionCreateParamsNonStreaming;

export interface ChatCompletionCreateParamsStreaming
  extends ChatCompletionCreateParamsBase {
  /**
   * If set, partial message deltas will be sent, like in ChatGPT. Tokens will be
   * sent as data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream: true;
}
