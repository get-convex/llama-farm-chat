import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { DatabaseReader } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { userMutation, userQuery } from "./users";
import { asyncMap, pruneNull } from "convex-helpers";
import { completionModels, STREAM_RESPONSES } from "@shared/config";
import { literals } from "convex-helpers/validators";
import { addJob } from "./workers";
import { defineRateLimits } from "convex-helpers/server/rateLimit";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const MAX_GROUP_SIZE = 25;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  sendMessage: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 3,
  },
  startThread: {
    kind: "token bucket",
    rate: 1,
    period: MINUTE,
    capacity: 2,
  },
  joinThread: {
    kind: "token bucket",
    rate: 1,
    period: SECOND,
  },
});

export const listThreads = userQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.userId) return [];
    const threads = await asyncMap(
      ctx.db
        .query("threadMembers")
        .withIndex("userId", (q) => q.eq("userId", ctx.userId!))
        .order("desc")
        .collect(),
      async (m) => {
        const thread = await ctx.db.get(m.threadId);
        let description = thread?.summary;
        if (!description) {
          description = (
            await messagesQuery(ctx, m.threadId)
              .filter((q) => q.neq(q.field("author.role"), "system"))
              .filter((q) => q.eq(q.field("state"), "success"))
              .first()
          )?.message;
        }
        const names = (
          await asyncMap(
            await ctx.db
              .query("threadMembers")
              .withIndex("threadId", (q) => q.eq("threadId", m.threadId))
              .collect(),
            async (m) => {
              const user = await ctx.db.get(m.userId);
              return user && user.name;
            },
          )
        ).concat("🦙");
        return (
          thread && {
            createdAt: thread._creationTime,
            uuid: thread.uuid,
            description,
            names,
          }
        );
      },
    );
    return pruneNull(threads);
  },
});

export const startThread = userMutation({
  args: { systemPrompt: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const uuid = crypto.randomUUID();
    await rateLimit(ctx, {
      name: "startThread",
      key: ctx.userId,
      throws: true,
    });
    const threadId = await ctx.db.insert("threads", { uuid });
    await ctx.db.insert("threadMembers", { threadId, userId: ctx.userId });
    if (args.systemPrompt) {
      await ctx.db.insert("messages", {
        message:
          args.systemPrompt ||
          "You are my friend with witty quips. Please be concise. Usually a sentence or two.",
        threadId,
        author: { role: "system" },
        state: "success",
      });
    }
    return uuid;
  },
});

export const joinThread = userMutation({
  args: { uuid: v.string() },
  handler: async (ctx, { uuid }) => {
    const thread = await threadFromUuid(ctx, uuid);
    if (!thread) {
      await rateLimit(ctx, {
        name: "startThread",
        key: ctx.userId,
        throws: true,
      });
    }
    const threadId = thread?._id ?? (await ctx.db.insert("threads", { uuid }));

    const existing = await getMembership(ctx, threadId, ctx.userId);
    if (!existing) {
      await rateLimit(ctx, {
        name: "joinThread",
        key: ctx.userId,
        throws: true,
      });
      const members = await ctx.db
        .query("threadMembers")
        .withIndex("threadId", (q) => q.eq("threadId", threadId))
        .collect();
      if (members.length >= MAX_GROUP_SIZE) {
        throw new ConvexError({
          kind: "MAX_GROUP_SIZE",
        });
      }
      await ctx.db.insert("threadMembers", {
        threadId,
        userId: ctx.userId,
      });
    }
  },
});

export const leaveThread = userMutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const thread = await threadFromUuid(ctx, args.uuid);
    if (!thread) {
      console.error("Thread not found");
      return;
    }
    const existing = await getMembership(ctx, thread._id, ctx.userId);
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const getThreadMessages = userQuery({
  args: { uuid: v.string(), paginationOpts: paginationOptsValidator },
  async handler(ctx, args) {
    const thread = await threadFromUuid(ctx, args.uuid);
    if (!thread) {
      console.error("Thread not found");
      return { page: [], continueCursor: null, isDone: true };
    }
    // All chats are public for now, if you know the uuid.
    // await checkThreadAccess(ctx, thread._id, ctx.userId);
    const results = await messagesQuery(ctx, thread._id)
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: await asyncMap(results.page, async (msg) => {
        // const image = m.imageId && (await ctx.db.get(m.imageId));
        const user =
          msg.author.role === "user"
            ? await ctx.db.get(msg.author.userId)
            : null;
        const model = msg.author.role === "assistant" ? msg.author.model : null;
        let job: Doc<"jobs"> | null = null;
        let sentAt = msg._creationTime;
        if (msg.state === "generating") {
          job = await ctx.db
            .query("jobs")
            .withIndex("responseId", (q) => q.eq("work.responseId", msg._id))
            .order("desc")
            .first();
          if (job) {
            sentAt = job.lastUpdate;
          }
        }
        return {
          // imageUrl:
          //   (image && (await ctx.storage.getUrl(image.storageId))) ?? null,
          id: msg._id,
          userId: user?._id,
          name: user?.name || model || msg.author.role,
          message: msg.message,
          role: msg.author.role,
          state: job?.status ?? msg.state,
          sentAt,
        };
      }),
    };
  },
});

async function anyPendingMessage(
  ctx: { db: DatabaseReader },
  userId: Id<"users">,
) {
  return ctx.db
    .query("messages")
    .withIndex("state", (q) =>
      q.eq("state", "generating").eq("author.userId", userId),
    )
    .first();
}

export const whenCanISendAnotherMessage = userQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.userId) return;
    const { ok, retryAt } = await checkRateLimit(ctx, {
      name: "sendMessage",
      key: ctx.userId,
    });
    return { now: ok, retryAt };
  },
});

export const sendMessage = userMutation({
  args: {
    message: v.string(),
    uuid: v.string(),
    model: literals(...completionModels),
    skipAI: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const thread = await threadFromUuid(ctx, args.uuid);
    if (!thread) {
      throw new ConvexError({
        kind: "THREAD_NOT_FOUND",
      });
    }
    const threadId = thread._id;
    const membership = await getMembership(ctx, threadId, ctx.userId);
    if (!membership) {
      throw new ConvexError({
        kind: "NOT_IN_THREAD",
      });
    }
    const { ok, retryAt } = await rateLimit(ctx, {
      name: "sendMessage",
      key: ctx.userId,
    });
    if (!ok) {
      return { retryAt };
    }
    await ctx.db.insert("messages", {
      message: args.message,
      threadId,
      author: { role: "user", userId: ctx.userId },
      state: "success",
    });

    if (args.skipAI || (await anyPendingMessage(ctx, ctx.userId))) return;
    const systemContext = await messagesQuery(ctx, threadId)
      .filter((q) => q.eq(q.field("author.role"), "system"))
      .order("desc")
      .first();
    const messageContext = (
      await messagesQuery(ctx, threadId)
        .filter((q) => q.neq(q.field("author.role"), "system"))
        .filter((q) => q.eq(q.field("state"), "success"))
        .order("desc")
        .take(5)
    ).reverse();
    const context = systemContext
      ? [systemContext, ...messageContext]
      : messageContext;
    // TODO: Decide which model to use, based on the question.
    // In particular, whether to do image or text.
    const author = {
      role: "assistant",
      model: args.model,
      context: context.map((m) => m._id),
    } as const;
    const messageId = await ctx.db.insert("messages", {
      message: "",
      author,
      state: "generating",
      threadId,
    });
    await addJob(ctx, messageId, STREAM_RESPONSES);
  },
});

async function threadFromUuid(ctx: { db: DatabaseReader }, uuid: string) {
  const thread = await ctx.db
    .query("threads")
    .withIndex("uuid", (q) => q.eq("uuid", uuid))
    .unique();
  return thread;
}

async function getMembership(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">,
  userId?: Id<"users">,
) {
  return (
    userId &&
    (await ctx.db
      .query("threadMembers")
      .withIndex("threadId", (q) =>
        q.eq("threadId", threadId).eq("userId", userId),
      )
      .unique())
  );
}

export function messagesQuery(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">,
) {
  return ctx.db
    .query("messages")
    .withIndex("threadId", (q) => q.eq("threadId", threadId));
}
