import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { DatabaseReader } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { userMutation, userQuery } from "./users";
import { asyncMap, pruneNull } from "convex-helpers";
import { completionModels, StreamResponses } from "@shared/config";
import { literals } from "convex-helpers/validators";
import { addJob } from "./workers";

export function messagesQuery(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">
) {
  return ctx.db
    .query("messages")
    .withIndex("threadId", (q) => q.eq("threadId", threadId));
}

export const listThreads = userQuery({
  args: {},
  handler: async ({ userId, db }) => {
    if (!userId) return [];
    const threads = await asyncMap(
      db
        .query("threadMembers")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .collect(),
      async (m) => {
        const thread = await db.get(m.threadId);
        return (
          thread && {
            createdAt: thread._creationTime,
            threadId: m.threadId,
            uuid: thread.uuid,
            summary: thread.summary,
          }
        );
      }
    );
    return pruneNull(threads);
  },
});

export const startThread = userMutation({
  args: { systemPrompt: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const uuid = crypto.randomUUID();
    const threadId = await ctx.db.insert("threads", { uuid });
    await ctx.db.insert("threadMembers", { threadId, userId: ctx.userId });
    if (args.systemPrompt) {
      await ctx.db.insert("messages", {
        message: args.systemPrompt || "You are my friend with witty quips",
        threadId,
        author: { role: "system" },
        state: "success",
      });
    }
    return threadId;
  },
});

export const joinThread = userMutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("uuid", (q) => q.eq("uuid", args.uuid))
      .unique();
    if (!thread) {
      throw new Error("Thread not found.");
    }
    const existing = await ctx.db
      .query("threadMembers")
      .withIndex("userId", (q) =>
        q.eq("userId", ctx.userId).eq("threadId", thread._id)
      )
      .unique();
    if (existing) {
      return;
    }
    await ctx.db.insert("threadMembers", {
      threadId: thread._id,
      userId: ctx.userId,
    });
  },
});

export const leaveThread = userMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const existing = await checkThreadAccess(ctx, args.threadId, ctx.userId);
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

async function checkThreadAccess(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">,
  userId?: Id<"users">
) {
  const member =
    userId &&
    (await ctx.db
      .query("threadMembers")
      .withIndex("userId", (q) =>
        q.eq("userId", userId).eq("threadId", threadId)
      )
      .unique());
  if (!member) {
    // We don't want to leak information about the thread existing.
    throw new Error("Thread not found or it isn't yours.");
  }
  return member;
}

export const getThreadMessages = userQuery({
  args: { threadId: v.id("threads"), paginationOpts: paginationOptsValidator },
  async handler(ctx, args) {
    await checkThreadAccess(ctx, args.threadId, ctx.userId);
    const results = await messagesQuery(ctx, args.threadId)
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
        return {
          // imageUrl:
          //   (image && (await ctx.storage.getUrl(image.storageId))) ?? null,
          userId: user?._id,
          name: user?.name || model || msg.author.role,
          message: msg.message,
          role: msg.author.role,
          state: msg.state,
        };
      }),
    };
  },
});

export const sendMessage = userMutation({
  args: {
    message: v.string(),
    threadId: v.id("threads"),
    model: literals(...completionModels),
    skipAI: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      message: args.message,
      threadId: args.threadId,
      author: { role: "user", userId: ctx.userId },
      state: "success",
    });
    if (args.skipAI) return;
    const systemContext = await messagesQuery(ctx, args.threadId)
      .filter((q) => q.eq(q.field("author.role"), "system"))
      .order("desc")
      .first();
    const messageContext = (
      await messagesQuery(ctx, args.threadId)
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
      message: "...",
      author,
      state: "generating",
      threadId: args.threadId,
    });
    await addJob(ctx, messageId, StreamResponses);
  },
});
