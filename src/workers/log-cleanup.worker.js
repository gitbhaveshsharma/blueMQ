const { Queue, Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { getDb } = require("../db");

const QUEUE_NAME = "schedule-log-cleanup";
const JOB_ID = "schedule-log-cleanup-weekly";

// Run every Sunday at 3:00 AM UTC
const CLEANUP_CRON = "0 3 * * 0";

// Purge logs older than 90 days
const RETENTION_DAYS = 90;

/**
 * Start the log cleanup worker.
 *
 * Runs as a weekly BullMQ repeatable job that purges old rows
 * from schedule_execution_logs to prevent unbounded table growth.
 *
 * @returns {Worker}
 */
function startLogCleanupWorker() {
  const connection = getRedisConnection();

  const queue = new Queue(QUEUE_NAME, { connection });

  // Register the repeatable job (idempotent — same jobId prevents duplicates)
  registerCleanupJob(queue).catch((err) => {
    console.error("[log-cleanup] Failed to register repeatable job:", err.message);
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log("[log-cleanup] Starting execution log cleanup...");

      try {
        const sql = getDb();
        const result = await sql`
          DELETE FROM schedule_execution_logs
          WHERE triggered_at < now() - INTERVAL '90 days'
        `;

        const deletedCount = result.length !== undefined ? result.length : 0;
        console.log(
          `[log-cleanup] Purged ${deletedCount} log rows older than ${RETENTION_DAYS} days`,
        );
      } catch (err) {
        console.error("[log-cleanup] Cleanup query failed:", err.message);
        throw err;
      }
    },
    { connection },
  );

  worker.on("completed", () => {
    console.log("[log-cleanup] Weekly cleanup completed");
  });

  worker.on("failed", (_job, err) => {
    console.error("[log-cleanup] Weekly cleanup failed:", err.message);
  });

  worker.on("error", (err) => {
    console.error("[log-cleanup] Worker error:", err.message);
  });

  console.log("[workers] log-cleanup worker started (weekly schedule)");
  return worker;
}

/**
 * Register (or re-register) the weekly cleanup repeatable job.
 */
async function registerCleanupJob(queue) {
  // Remove any existing repeatable with our stable ID
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.id === JOB_ID) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add(
    "cleanup-schedule-logs",
    {},
    {
      repeat: { pattern: CLEANUP_CRON },
      jobId: JOB_ID,
    },
  );

  console.log(`[log-cleanup] Registered weekly cleanup job (${CLEANUP_CRON})`);
}

module.exports = { startLogCleanupWorker };
