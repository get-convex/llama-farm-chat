const SECOND = 1000;

export const STREAM_RESPONSES = true;
// How long the server should wait before considering a request failed.
export const WORKER_DEAD_TIMEOUT = 60 * SECOND;
// How often the worker should send a heartbeat to the server.
export const WORKER_HEARTBEAT_INTERVAL = 20 * SECOND;
// How many times should a job be retried when a client reports failure.
// Note: this doesn't capture workers considered dead from timeouts.
export const MAX_JOB_RETRIES = 3;

// You can add / remove whatever models you want to use here.
export const completionModels = [
  "llama3",
  "codegemma",
  "codellama:7b",
  "llama2",
  "mistral",
] as const;
export type CompletionModels = (typeof completionModels)[number];
