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
import { customMutation } from "convex-helpers/server/customFunctions";
import { asyncMap } from "convex-helpers";
import { Scheduler } from "convex/server";

const Minute = 60_000;
const WorkerDeadTimeout = 5 * Minute;

export async function addJob(
  ctx: { db: DatabaseWriter },
  messageId: Id<"messages">
) {
  const message = await validateResponseMessage(ctx, messageId);
  await ctx.db.insert("jobs", {
    lastUpdate: Date.now(),
    status: "pending",
    work: {
      responseId: message._id,
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

    return { ctx: { worker }, args: {} };
  },
});

async function validateResponseMessage(
  ctx: { db: DatabaseReader },
  messageId: Id<"messages">
) {
  const message = await ctx.db.get(messageId);
  if (!message) {
    throw new Error("Invalid message ID");
  }
  if (message.author.role !== "assistant") {
    throw new Error("A job should be for an assistant: " + message.author.role);
  }
  return message as Doc<"messages"> & {
    author: { role: "assistant"; context: Id<"messages">[] };
  };
}

export const giveMeWork = workerMutation({
  args: {},
  handler: async (ctx) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("status", (q) => q.eq("status", "pending"))
      .first();
    if (!job) {
      return null;
    }

    const janitorId = await scheduleJanitor(ctx, job);
    await ctx.db.patch(job._id, {
      lastUpdate: Date.now(),
      status: "inProgress",
      workerId: ctx.worker._id,
      janitorId,
    });
    const message = await validateResponseMessage(ctx, job.work.responseId);
    return {
      jobId: job._id,
      messages: asyncMap(message.author.context, (msg) =>
        ctx.db.get(msg).then(
          (message) =>
            message && {
              role: message.author.role,
              content: message.message,
            }
        )
      ),
    };
  },
});

async function scheduleJanitor(
  ctx: { scheduler: Scheduler },
  job: Doc<"jobs">
) {
  if (job.janitorId) {
    await ctx.scheduler.cancel(job.janitorId);
  }
  const janitorId = await ctx.scheduler.runAfter(
    WorkerDeadTimeout,
    internal.workers.markAsDead,
    {
      jobId: job._id,
    }
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
      status: "failed",
    });
  },
});

export const imStillWorking = workerMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await validateJob(ctx, args.jobId, ctx.worker);
    // cancel and re-schedule the janitor
    const janitorId = await scheduleJanitor(ctx, job);
    await ctx.db.patch(job._id, { lastUpdate: Date.now(), janitorId });
  },
});

async function validateJob(
  ctx: { db: DatabaseReader },
  jobId: Id<"jobs">,
  worker: Doc<"workers">
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

export const reportWork = workerMutation({
  args: { jobId: v.id("jobs"), message: v.string() },
  handler: async (ctx, args) => {
    const job = await validateJob(ctx, args.jobId, ctx.worker);
    if (job.janitorId) await ctx.scheduler.cancel(job.janitorId);
    await ctx.db.patch(job._id, {
      lastUpdate: Date.now(),
      status: "success",
    });
    const message = await ctx.db.get(job.work.responseId);
    if (!message) {
      throw new Error("Invalid response message ID");
    }
    await ctx.db.patch(message._id, {
      message: args.message,
      state: "done",
    });
  },
});

export const signMeUp = internalMutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const apiKey = crypto.randomUUID();
    const workerId = await ctx.db.insert("workers", {
      name: args.name,
      apiKey,
    });
    return { workerId: workerId, apiKey };
  },
});

export const refreshMyKey = workerMutation({
  args: {},
  handler: async (ctx) => {
    const uuid = crypto.randomUUID();
    await ctx.db.patch(ctx.worker._id, { apiKey: uuid });
    return uuid;
  },
});
