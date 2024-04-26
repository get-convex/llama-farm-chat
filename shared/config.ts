const Second = 1000;

export const StreamResponses = true;
// How long the server should wait before considering a request failed.
export const WorkerDeadTimeout = 60 * Second;
// How often the worker should send a heartbeat to the server.
export const WorkerHeartbeatInterval = 20 * Second;
// How many times should a job be retried when a client reports failure.
// Note: this doesn't capture workers considered dead from timeouts.
export const MaxJobRetries = 3;

// You can add / remove whatever models you want to use here.
export const completionModels = [
  "llama3",
  "codegemma",
  "codellama:7b",
  "llama2",
  "mistral",
] as const;
export type CompletionModels = (typeof completionModels)[number];
