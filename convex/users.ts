import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";

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
      userId = await ctx.db.insert("users", { name: "" });
    }

    return { ctx: { userId }, args: {} };
  },
});

export const updateName = userMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.patch(ctx.userId, { name: args.name });
  },
});
