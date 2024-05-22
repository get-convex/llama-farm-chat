import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { Emojis } from "@shared/config";
import { defineRateLimits } from "convex-helpers/server/rateLimit";

const Second = 1000;
const Minute = 60 * Second;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  createUser: {
    kind: "token bucket",
    rate: 1,
    period: Minute,
    capacity: 50,
  },
  updateName: {
    kind: "token bucket",
    rate: 1,
    period: Second,
  },
});

export const userQuery = customQuery(query, {
  args: {
    sessionId: v.string(),
  },
  input: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    return { ctx: { userId: session?.userId }, args: {} };
  },
});

export const userMutation = customMutation(mutation, {
  args: {
    sessionId: v.string(),
  },
  input: async (ctx, args) => {
    const user = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    let userId;
    if (user) {
      userId = user.userId;
    } else {
      await rateLimit(ctx, {
        name: "createUser",
        key: args.sessionId,
        throws: true,
      });
      userId = await ctx.db.insert("users", {
        name: Emojis[Math.floor(Math.random() * Emojis.length)],
      });
      await ctx.db.insert("sessions", { userId, sessionId: args.sessionId });
    }

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

export const updateName = userMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: "updateName",
      key: ctx.userId,
      throws: true,
    });
    return ctx.db.patch(ctx.userId, { name: args.name });
  },
});
