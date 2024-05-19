import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
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

type SlidingRateLimit = {
  kind: "sliding";
  rate: number;
  period: number;
  burst?: number;
  maxReserved?: number;
};

function isMutationCtx(ctx: QueryCtx): ctx is MutationCtx {
  return "insert" in ctx.db;
}

function defineRateLimits<Limits extends Record<string, SlidingRateLimit>>(
  limits: Limits,
) {
  async function getExisting(ctx: QueryCtx, name: RateLimitNames, key: string) {
    return ctx.db
      .query("rateLimits")
      .withIndex("name", (q) => q.eq("name", name).eq("key", key))
      .unique();
  }

  type RateLimitNames = keyof Limits & string;

  async function resetRateLimit<Name extends string = RateLimitNames>(
    ctx: MutationCtx,
    args: { name: Name; key: string },
  ) {
    const existing = await getExisting(ctx, args.name, args.key);
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  }

  async function rateLimit<
    Ctx extends QueryCtx,
    Name extends string = RateLimitNames,
  >(
    ctx: Ctx,
    args: Name extends RateLimitNames
      ? Ctx extends MutationCtx
        ? {
            name: Name;
            key: string;
            count?: number;
            consume?: boolean;
            reserve?: boolean;
            config?: undefined;
            throws?: boolean;
          }
        : {
            name: Name;
            key: string;
            count?: number;
            consume: false;
            reserve?: boolean;
            config?: undefined;
            throws?: boolean;
          }
      : Ctx extends MutationCtx
        ? {
            name: Name;
            key: string;
            count?: number;
            consume?: boolean;
            reserve?: boolean;
            config: SlidingRateLimit;
            throws?: boolean;
          }
        : {
            name: Name;
            key: string;
            count?: number;
            consume: false;
            reserve?: boolean;
            config: SlidingRateLimit;
            throws?: boolean;
          },
  ) {
    const config = limits[args.name] ?? args.config;
    if (!config) {
      throw new Error(`Rate limit ${args.name} config not defined.`);
    }
    const existing = await getExisting(ctx, args.name, args.key);
    const now = Date.now();
    let state: Doc<"rateLimits">["state"];
    let id = existing?._id;
    if (existing) {
      state = existing.state;
    } else {
      state = {
        kind: "sliding",
        value: config.rate,
        updatedAt: now,
      };
      if (isMutationCtx(ctx)) {
        id = await ctx.db.insert("rateLimits", {
          name: args.name,
          key: args.key,
          state,
        });
      }
    }
    const elapsed = now - state.updatedAt;
    const max = config.burst ?? config.rate;
    const rate = config.rate / config.period;
    const value = Math.min(state.value + elapsed * rate, max);
    const count = args.count ?? 1;
    if (args.reserve) {
      if (config.maxReserved && count > max + config.maxReserved) {
        throw new Error(
          `Rate limit ${args.name} count exceeds ${max + config.maxReserved}.`,
        );
      }
    } else {
      if (count > max) {
        throw new Error(`Rate limit ${args.name} count exceeds ${max}.`);
      }
    }
    let ret: {
      ok: boolean;
      retryAt: number | undefined;
      reserved: boolean;
    } = { ok: true, retryAt: undefined, reserved: false };

    if (value < count) {
      const deficit = count - value;
      const retryAt = now + deficit / rate;
      if (
        !args.reserve ||
        (config.maxReserved && deficit > config.maxReserved)
      ) {
        if (args.throws) {
          throw new ConvexError({
            kind: "RateLimited",
            name: args.name,
            ok: false,
            retryAt,
          });
        }
        return { ok: false, retryAt, reserved: false };
      }
      ret = { ok: false, retryAt, reserved: true };
    }

    if (args.consume !== false && isMutationCtx(ctx)) {
      state.updatedAt = now;
      state.value = value - count;
      await ctx.db.patch(id!, { state });
    }
    return ret;
  }
  return { rateLimit, resetRateLimit };
}

const Second = 1_000;
const Minute = 60 * Second;
// const Hour = 60 * Minute;

const { rateLimit, resetRateLimit } = defineRateLimits({
  sendMessage: { kind: "sliding", rate: 1, period: 30 * Second, burst: 5 },
});

export const whenCanISendAnotherMessage = userQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.userId) return;
    const { ok, retryAt } = await rateLimit(ctx, {
      name: "sendMessage",
      key: ctx.userId,
      consume: false,
    });
    return { ok, retryAt };
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

    const { ok, retryAt } = await rateLimit(ctx, {
      name: "sendMessage",
      key: ctx.userId,
      throws: true,
    });
    if (!ok) {
      return { retryAt };
    }

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
    await addJob(ctx, messageId, StreamResponses);
  },
});

async function threadFromUuid(
  ctx: { db: DatabaseReader },
  uuid: string,
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
