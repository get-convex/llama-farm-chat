import { internalMutation, mutation, query } from "./_generated/server";
import {
  CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { auth } from "./auth";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { nullable } from "convex-helpers/validators";

export const userQuery = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const userId = (await auth.getUserId(ctx)) ?? undefined;
    return { ctx: { userId }, args: {} };
  },
});

export const userMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    return { ctx: { userId }, args: {} };
  },
});

export type UserMutationCtx = CustomCtx<typeof userMutation>;

export const me = userQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.userId) return null;
    return ctx.db.get(ctx.userId);
  },
});

export const captureAnonUser = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) return false;
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    const oldUserId = session?.userId;
    if (!oldUserId) return true;
    for await (const membership of ctx.db
      .query("threadMembers")
      .withIndex("userId", (q) => q.eq("userId", oldUserId))) {
      await ctx.db.patch(membership._id, {
        userId,
      });
      await ctx.scheduler.runAfter(0, internal.users.captureUserMessages, {
        threadId: membership.threadId,
        oldUserId,
        userId,
        cursor: null,
      });
    }
    return true;
  },
});

export const captureUserMessages = internalMutation({
  args: {
    threadId: v.id("threads"),
    oldUserId: v.id("users"),
    userId: v.id("users"),
    cursor: nullable(v.string()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("threadId", (q) => q.eq("threadId", args.threadId))
      .paginate({ cursor: args.cursor, numItems: 100 });
    for (const message of messages.page) {
      if (
        message.author.role === "user" &&
        message.author.userId === args.oldUserId
      ) {
        await ctx.db.patch(message._id, {
          author: { ...message.author, userId: args.userId },
        });
      }
    }
    if (!messages.isDone) {
      await ctx.scheduler.runAfter(0, internal.users.captureUserMessages, {
        ...args,
        cursor: messages.continueCursor,
      });
    }
  },
});
