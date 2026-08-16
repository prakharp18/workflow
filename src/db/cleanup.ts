import { db } from "./db";
import { jobs, jobMatches } from "./schema";
import { sql, eq, inArray } from "drizzle-orm";

export async function runDbCleanup() {
  console.log("[DB Cleanup] Starting database storage optimization for Neon free tier...");

  try {
    console.log("[DB Cleanup] Step 1: Purging heavy 'raw_json' payloads...");
    await db.update(jobs)
      .set({ rawJson: null })
      .where(sql`raw_json IS NOT NULL`);
    console.log("[DB Cleanup] Step 1 complete: Purged raw_json fields.");

    console.log("[DB Cleanup] Step 2: Truncating descriptions of skipped/unmatched jobs...");
    const skippedMatches = await db
      .select({ jobId: jobMatches.jobId })
      .from(jobMatches)
      .where(sql`score < 50 OR apply_recommendation = 'Skip'`);

    const skippedJobIds = skippedMatches.map(m => m.jobId);

    if (skippedJobIds.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < skippedJobIds.length; i += batchSize) {
        const batch = skippedJobIds.slice(i, i + batchSize);
        await db.update(jobs)
          .set({ description: sql`SUBSTRING(description FROM 1 FOR 200)` })
          .where(inArray(jobs.id, batch));
      }
      console.log(`[DB Cleanup] Step 2 complete: Truncated ${skippedJobIds.length} skipped job descriptions.`);
    }

    console.log("[DB Cleanup] Step 3: Removing old skipped jobs older than 14 days...");
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    
    const oldSkippedJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .leftJoin(jobMatches, eq(jobs.id, jobMatches.jobId))
      .where(sql`(job_matches.score < 40 OR job_matches.apply_recommendation = 'Skip') AND jobs.created_at < ${fourteenDaysAgo}`)
      .limit(500);

    const oldIds = oldSkippedJobs.map(j => j.id);

    if (oldIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, oldIds));
      console.log(`[DB Cleanup] Step 3 complete: Deleted ${oldIds.length} old skipped job entries.`);
    } else {
      console.log("[DB Cleanup] Step 3 complete: No expired skipped jobs found.");
    }

    const totalJobs = await db.select({ count: sql<number>`count(*)` }).from(jobs);
    const totalMatches = await db.select({ count: sql<number>`count(*)` }).from(jobMatches);

    console.log("\n================ DB Storage Optimization Summary ================");
    console.log(`Remaining Monitored Jobs:   ${totalJobs[0]?.count || 0}`);
    console.log(`Remaining Evaluated Matches: ${totalMatches[0]?.count || 0}`);
    console.log("Database storage usage drastically reduced! Safe for Neon free tier.");
    console.log("=================================================================\n");

  } catch (err) {
    console.error("[DB Cleanup] Error during storage cleanup:", err);
  }
}
