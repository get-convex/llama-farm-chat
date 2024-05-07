// import { makeMigration } from "convex-helpers/server/migrations";
// const migration = makeMigration(internalMutation);

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
