import { cronJobs } from "convex/server";
import { asyncMap } from "convex-helpers";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const DeadThreshold = 30_000;
const crons = cronJobs();

export const detectDeadJobs = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const deadJobs = await ctx.db
      .query("jobs")
      .withIndex("status", (q) =>
        q
          .eq("status", "inProgress")
          .lt("lastUpdate", Date.now() - DeadThreshold)
      )
      .take(1000);
    await asyncMap(deadJobs, async (job) => {
      console.warn("Detected dead job", job._id, job.workerId);
      if (!job.workerId) {
        throw new Error("Job is in progress but has no workerId");
      }
      await ctx.db.insert("failures", {
        workerId: job.workerId,
        jobId: job._id,
      });
      await ctx.db.patch(job._id, {
        status: "pending",
        lastUpdate: Date.now(),
        workerId: undefined,
      });
    });
  },
});

crons.interval(
  "detectDeadJobs",
  { seconds: 60 },
  internal.crons.detectDeadJobs
);

export default crons;
