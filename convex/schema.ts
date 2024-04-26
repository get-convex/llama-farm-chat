// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { literals } from "convex-helpers/validators";

const message = v.object({
  content: v.string(),
  role: literals("system", "user", "assistant"),
});

export default defineSchema(
  {
    users: defineTable({
      name: v.string(),
    }),
    jobs: defineTable({
      work: v.object({
        responseId: v.id("messages"),
      }),
      status: literals("pending", "inProgress", "success", "failed"),
      lastUpdate: v.number(),
      workerId: v.optional(v.id("workers")),
      janitorId: v.optional(v.id("_scheduled_functions")),
    }).index("status", ["status", "lastUpdate"]),
    failures: defineTable({
      workerId: v.id("workers"),
      jobId: v.id("jobs"),
    }),
    workers: defineTable({
      apiKey: v.string(),
      name: v.optional(v.string()),
    }).index("apiKey", ["apiKey"]),
    messages: defineTable({
      message: v.string(),
      threadId: v.id("threads"),
      // imageId: v.optional(v.id("images")),
      author: v.union(
        v.object({
          role: v.literal("system"),
        }),
        v.object({
          role: v.literal("assistant"),
          context: v.array(v.id("messages")),
          // model: v.optional(v.string()), // To support more than llama3
        }),
        v.object({
          role: v.literal("user"),
          userId: v.id("users"),
        })
      ),
      state: v.union(
        v.literal("generating"),
        v.literal("done"),
        v.literal("archived")
      ),
    }).index("threadId", ["threadId"]),
    threads: defineTable({
      summary: v.optional(v.string()),
      summarizer: v.optional(v.id("_scheduled_functions")),
      // summaryEmbeddingId: v.optional(v.id("threadSummaryEmbeddings")),
      userId: v.id("users"),
    }).index("userId", ["userId"]),
    // .index("summaryEmbeddingId", ["summaryEmbeddingId"]),
    threadMembers: defineTable({
      threadId: v.id("threads"),
      userId: v.id("users"),
    }).index("userId", ["userId"]),
    // .index("threadId", ["threadId"]),
  },
  // If you ever get an error about schema mismatch
  // between your data and your schema, and you cannot
  // change the schema to match the current data in your database,
  // you can:
  //  1. Use the dashboard to delete tables or individual documents
  //     that are causing the error.
  //  2. Change this option to `false` and make changes to the data
  //     freely, ignoring the schema. Don't forget to change back to `true`!
  { schemaValidation: true }
);
