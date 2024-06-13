import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  DatabaseReader,
  DatabaseWriter,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  CustomCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { asyncMap, pruneNull } from "convex-helpers";
import { Scheduler } from "convex/server";
import { MAX_JOB_RETRIES, WORKER_DEAD_TIMEOUT } from "../shared/config";
import { literals } from "convex-helpers/validators";

export async function addJob(
  ctx: { db: DatabaseWriter },
  messageId: Id<"messages">,
  stream: boolean,
) {
  const message = await validateResponseMessage(ctx, messageId);
  return ctx.db.insert("jobs", {
    lastUpdate: Date.now(),
    status: "pending",
    work: {
      responseId: message._id,
      stream,
    },
  });
}

export const isThereWork = query({
  args: {},
  handler: async (ctx) => {
    const work = await ctx.db
      .query("jobs")
      .withIndex("status", (q) => q.eq("status", "pending"))
      .first();
    return !!work;
  },
});

const workerMutation = customMutation(mutation, {
  // We could just take the apiKey and look up the worker, but this is easier.
  args: { apiKey: v.string() },
  input: async (ctx, args) => {
    const worker = await ctx.db
      .query("workers")
      .withIndex("apiKey", (q) => q.eq("apiKey", args.apiKey))
      .unique();
    if (!worker) {
      throw new Error("Invalid API key");
    }

    return { ctx: { worker }, args: { key: args.apiKey } };
  },
});
type WorkerCtx = CustomCtx<typeof workerMutation>;

async function validateResponseMessage(
  ctx: { db: DatabaseReader },
  messageId: Id<"messages">,
) {
  const message = await ctx.db.get(messageId);
  if (!message) {
    throw new Error("Invalid message ID");
  }
  if (message.author.role !== "assistant") {
    throw new Error("A job should be for an assistant: " + message.author.role);
  }
  // This is a fancy way to tell TypeScript message.author.role === assistant
  return message as Omit<Doc<"messages">, "author"> & {
    author: Extract<Doc<"messages">["author"], { role: "assistant" }>;
  };
}

export const giveMeWork = workerMutation({
  args: {},
  handler: claimWork,
});

async function bumpWorkerLastSeen(ctx: WorkerCtx) {
  await ctx.db.patch(ctx.worker._id, { lastSeen: Date.now() });
}

async function claimWork(ctx: WorkerCtx) {
  await bumpWorkerLastSeen(ctx);
  const job = await ctx.db
    .query("jobs")
    .withIndex("status", (q) => q.eq("status", "pending"))
    .first();
  if (!job) {
    return null;
  }
  const attempts = await ctx.db
    .query("jobs")
    .withIndex("responseId", (q) =>
      q.eq("work.responseId", job.work.responseId),
    )
    .collect();
  if (attempts.find((j) => j.workerId === ctx.worker._id)) {
    // 10% of the time we should try again
    // Otherwise, don't retry a job we previously attempted.
    // 10% means if there's only one worker it won't sit in an infinite loop
    // trying to fetch the same job.
    if (Math.random() > 0.1) {
      return null;
    }
  }

  const janitorId = await scheduleJanitor(ctx, job);
  await ctx.db.patch(job._id, {
    lastUpdate: Date.now(),
    status: "inProgress",
    workerId: ctx.worker._id,
    start: Date.now(),
    janitorId,
  });
  const message = await validateResponseMessage(ctx, job.work.responseId);
  return {
    jobId: job._id,
    stream: job.work.stream,
    model: message.author.model,
    messages: pruneNull(
      await asyncMap(message.author.context, (msg) =>
        ctx.db.get(msg).then(simpleMessage),
      ),
    ),
  };
}

function simpleMessage(message: Doc<"messages"> | null) {
  return (
    message && {
      content: message.message,
      role: message.author.role,
    }
  );
}

async function scheduleJanitor(
  ctx: { scheduler: Scheduler },
  job: Doc<"jobs">,
) {
  if (job.janitorId) {
    await ctx.scheduler.cancel(job.janitorId);
  }
  const janitorId = await ctx.scheduler.runAfter(
    WORKER_DEAD_TIMEOUT,
    internal.workers.markAsDead,
    {
      jobId: job._id,
    },
  );
  return janitorId;
}

export const markAsDead = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Invalid job ID");
    }
    if (job.status !== "inProgress") {
      return;
    }
    // TODO: could add a retry, but by now the user probably moved on.
    await ctx.db.patch(job._id, {
      lastUpdate: Date.now(),
      status: "timedOut",
    });
  },
});

export const imStillWorking = workerMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    await bumpWorkerLastSeen(ctx);
    const job = await validateJob(ctx, args.jobId, ctx.worker);
    // cancel and re-schedule the janitor
    const janitorId = await scheduleJanitor(ctx, job);
    await ctx.db.patch(job._id, { lastUpdate: Date.now(), janitorId });
  },
});

async function validateJob(
  ctx: { db: DatabaseReader },
  jobId: Id<"jobs">,
  worker: Doc<"workers">,
) {
  const job = await ctx.db.get(jobId);
  if (!job) {
    throw new Error("Invalid job ID");
  }
  if (job.status !== "inProgress") {
    throw new Error("Job is not in progress: " + job.status);
  }
  if (job.workerId !== worker._id) {
    throw new Error("Job is not assigned to this worker");
  }
  return job;
}

export const submitWork = workerMutation({
  args: {
    jobId: v.id("jobs"),
    message: v.string(),
    state: literals("streaming", "success", "failed"),
  },
  handler: async (ctx, args) => {
    await bumpWorkerLastSeen(ctx);
    const job = await validateJob(ctx, args.jobId, ctx.worker);
    const message = await validateResponseMessage(ctx, job.work.responseId);
    switch (args.state) {
      case "streaming":
        message.message += args.message;
        break;
      case "success":
      case "failed":
        message.message += args.message;
        message.state = args.state;
        if (job.janitorId) await ctx.scheduler.cancel(job.janitorId);
        await ctx.db.patch(job._id, {
          lastUpdate: Date.now(),
          status: args.state,
          end: Date.now(),
        });
        // See if we should retry
        if (args.state === "failed") {
          const attempts = (
            await ctx.db
              .query("jobs")
              .withIndex("responseId", (q) =>
                q.eq("work.responseId", message._id),
              )
              .collect()
          ).length;
          if (attempts <= MAX_JOB_RETRIES) {
            await addJob(ctx, message._id, job.work.stream);
          }
        }
        break;
    }
    await ctx.db.replace(message._id, message);
    return args.state === "streaming" ? null : claimWork(ctx);
  },
});

export const signMeUp = internalMutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const apiKey = crypto.randomUUID();
    await ctx.db.insert("workers", {
      name: args.name,
      apiKey,
      lastSeen: Date.now(),
    });
    return apiKey;
  },
});

export const refreshMyKey = internalMutation({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const uuid = crypto.randomUUID();
    const worker = await ctx.db
      .query("workers")
      .withIndex("apiKey", (q) => q.eq("apiKey", args.apiKey))
      .unique();
    if (!worker) {
      throw new Error("Invalid API key");
    }
    await ctx.db.patch(worker._id, { apiKey: uuid, lastSeen: Date.now() });
    return uuid;
  },
});
