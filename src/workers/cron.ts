import cron from "node-cron";
import { runJobSync } from "../core/sync";
import dotenv from "dotenv";

dotenv.config();

const schedule = process.env.CRON_SCHEDULE || "0 * * * *"; // Default hourly

export function startBackgroundWorker() {
  console.log(`[Worker] Starting background scheduler with schedule: "${schedule}"`);
  
  cron.schedule(schedule, async () => {
    console.log("[Worker] Running scheduled job synchronization...");
    try {
      await runJobSync();
      console.log("[Worker] Scheduled sync complete.");
    } catch (err) {
      console.error("[Worker] Scheduled sync failed:", err);
    }
  });
}
