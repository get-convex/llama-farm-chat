import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { DatabaseReader } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { userMutation, userQuery } from "./users";
import { asyncMap } from "convex-helpers";
import { completionModels, StreamResponses } from "../shared/config";
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
    return userId
      ? db
          .query("threadMembers")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .collect()
      : [];
  },
});

export const startThread = userMutation({
  args: { systemPrompt: v.string() },
  handler: async (ctx, args) => {
    const uuid = crypto.randomUUID();
    const threadId = await ctx.db.insert("threads", { uuid });
    await ctx.db.insert("threadMembers", { threadId, userId: ctx.userId });
    if (args.systemPrompt) {
      await ctx.db.insert("messages", {
        message: args.systemPrompt,
        threadId,
        author: { role: "system" },
        state: "success",
      });
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
        return {
          // imageUrl:
          //   (image && (await ctx.storage.getUrl(image.storageId))) ?? null,
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      message: args.message,
      threadId: args.threadId,
      author: { role: "user", userId: ctx.userId },
      state: "success",
    });
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
