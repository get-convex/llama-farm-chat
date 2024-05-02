import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { DatabaseReader } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { userMutation, userQuery } from "./users";
import { asyncMap, pruneNull } from "convex-helpers";
import { completionModels, StreamResponses } from "@shared/config";
import { literals } from "convex-helpers/validators";
import { addJob } from "./workers";

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
              .order("desc")
              .filter((q) => q.neq(q.field("author.role"), "system"))
              .filter((q) => q.eq(q.field("state"), "success"))
              .first()
          )?.message;
        }
        return (
          thread && {
            createdAt: thread._creationTime,
            uuid: thread.uuid,
            description,
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
    return uuid;
  },
});

export const joinThread = userMutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const thread = await threadFromUuid(ctx, args.uuid);
    const existing = await getMembership(ctx, thread._id, ctx.userId);
    if (!existing) {
      await ctx.db.insert("threadMembers", {
        threadId: thread._id,
        userId: ctx.userId,
      });
    }
  },
});

export const leaveThread = userMutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const thread = await threadFromUuid(ctx, args.uuid);
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
    uuid: v.string(),
    model: literals(...completionModels),
    skipAI: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { _id: threadId } = await threadFromUuid(ctx, args.uuid);
    await ctx.db.insert("messages", {
      message: args.message,
      threadId,
      author: { role: "user", userId: ctx.userId },
      state: "success",
    });
    if (args.skipAI) return;
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
      message: "...",
      author,
      state: "generating",
      threadId,
    });
    await addJob(ctx, messageId, StreamResponses);
  },
});

async function threadFromUuid(
  ctx: { db: DatabaseReader },
  uuid: string
): Promise<Doc<"threads">> {
  const thread = await ctx.db
    .query("threads")
    .withIndex("uuid", (q) => q.eq("uuid", uuid))
    .unique();
  if (!thread) {
    throw new Error("Thread not found.");
  }
  return thread;
}

async function getMembership(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">,
  userId?: Id<"users">
) {
  return (
    userId &&
    (await ctx.db
      .query("threadMembers")
      .withIndex("threadId", (q) =>
        q.eq("threadId", threadId).eq("userId", userId)
      )
      .unique())
  );
}

export function messagesQuery(
  ctx: { db: DatabaseReader },
  threadId: Id<"threads">
) {
  return ctx.db
    .query("messages")
    .withIndex("threadId", (q) => q.eq("threadId", threadId));
}
