import { makeMigration } from "convex-helpers/server/migrations";
import { internalMutation } from "./_generated/server";
const migration = makeMigration(internalMutation);

/**
 * Remove the retries field from jobs.
retries: v.number(),
export const snipRetries = migration({
  table: "jobs",
  migrateOne: async (_ctx, job) => {
    return { retries: undefined };
  },
});
*/

/**
 * Add isAnonymous to existing users.
 * Future users will log in and have isAnonymous set to false.
 * Then maybe we'll reintroduce anonymous users explicitly.
 */
export const makeAnonymousUsers = migration({
  table: "users",
  migrateOne(ctx, doc) {
    if ("isAnonymous" in doc) return;
    return { isAnonymous: true };
  },
});
