const { Queue, Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { getDb } = require("../db");
const { getPollIntervalCron } = require("../utils/config-resolver.util");
const { computeNextRun } = require("../utils/compute-next-run.util");
const { signRequest } = require("../utils/hmac.util");
const { enqueueNotification } = require("../queues/enqueue");

const QUEUE_NAME = "scheduled-notification-poller";
const STABLE_JOB_ID = "scheduled-notification-poll";
const CONFIG_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Register (or re-register) the repeatable poll job in Redis.
 *
 * FIX 3 & FIX 8: BullMQ repeatable jobs live in Redis.
 * We must remove the old job and re-add with the new cron
 * whenever the interval changes. Uses a stable jobId to
 * prevent duplicates across PM2 restarts.
 */
async function registerPoller(queue, intervalCron) {
  // 1. Remove any existing repeatable with our stable ID
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.id === STABLE_JOB_ID) {
      await queue.removeRepeatableByKey(job.key);
      console.log("[schedule-worker] Removed old repeatable job");
    }
  }

  // 2. Re-add with the (potentially new) cron
  await queue.add(
    "poll-scheduled-notifications",
    {},
    {
      repeat: { pattern: intervalCron },
      jobId: STABLE_JOB_ID,
    },
  );

  console.log(
    `[schedule-worker] Registered poll job with cron: ${intervalCron}`,
  );
}

/**
 * Call a schedule's data_source_url with HMAC-signed headers.
 *
 * FIX 4: 8-second timeout via AbortController.
 *
 * @param {object} schedule — the full schedule row
 * @returns {object} parsed JSON response
 */
async function callDataSource(schedule) {
  const requestBody = JSON.stringify({
    schedule_id: schedule.id,
    client_id: schedule.client_id,
    template_key: schedule.template_key,
    triggered_at: new Date().toISOString(),
  });

  const signature = signRequest(schedule.data_source_secret, requestBody);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(schedule.data_source_url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-bluemq-signature": `sha256=${signature}`,
        "x-bluemq-schedule-id": schedule.id,
        "x-bluemq-client-id": schedule.client_id,
      },
      body: requestBody,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `data_source_url returned ${res.status}: ${text.substring(0, 200)}`,
      );
    }

    const data = await res.json();

    if (!data || !Array.isArray(data.notifications)) {
      throw new Error(
        "Invalid response from data_source_url: missing notifications array",
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process a single due schedule: call data source, enqueue
 * notifications, update state.
 *
 * Runs inside the transaction (client is a pg Client from pool.connect()).
 * Each schedule is processed in its own try/catch so one failure
 * never blocks others.
 *
 * @param {object} schedule — the schedule row (with FOR UPDATE lock)
 * @param {object} client   — pg Client (from pool.connect()) for transactional queries
 */
async function processSchedule(schedule, client) {
  let sourceData;

  try {
    sourceData = await callDataSource(schedule);
  } catch (fetchErr) {
    // data_source_url failure → increment retry_count
    const newRetryCount = (schedule.retry_count || 0) + 1;

    if (newRetryCount >= schedule.max_retries) {
      // Exhausted retries → mark as failed
      await client.query(
        `UPDATE scheduled_notifications
         SET retry_count = $2, status = 'failed', last_run_status = 'failed',
             last_run_at = now(), updated_at = now()
         WHERE id = $1`,
        [schedule.id, newRetryCount],
      );

      console.error(
        `[schedule-worker] Schedule ${schedule.id} FAILED after ${newRetryCount} retries: ${fetchErr.message}`,
      );
    } else {
      // Still has retries left → leave next_run_at unchanged (retry on next poll)
      await client.query(
        `UPDATE scheduled_notifications
         SET retry_count = $2, updated_at = now()
         WHERE id = $1`,
        [schedule.id, newRetryCount],
      );

      console.warn(
        `[schedule-worker] Schedule ${schedule.id} fetch failed (retry ${newRetryCount}/${schedule.max_retries}): ${fetchErr.message}`,
      );
    }

    // Log the failure
    await client.query(
      `INSERT INTO schedule_execution_logs
         (schedule_id, client_id, triggered_by, status, error_message)
       VALUES ($1, $2, 'scheduler', 'failed', $3)`,
      [schedule.id, schedule.client_id, fetchErr.message],
    );

    return;
  }

  // ─── FIX 5: Empty notifications array = success ───
  const notifications = sourceData.notifications;
  let successCount = 0;
  let failCount = 0;

  // Process each notification (enqueue is Redis-based, safe inside transaction)
  for (const item of notifications) {
    try {
      if (!item.user_id || !item.channels || !Array.isArray(item.channels)) {
        console.warn(
          `[schedule-worker] Skipping invalid item in schedule ${schedule.id}`,
        );
        failCount++;
        continue;
      }

      // Insert master notification row
      const insertResult = await client.query(
        `INSERT INTO notifications
           (app_id, external_user_id, type, title, message, data, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING id`,
        [
          schedule.client_id,
          item.user_id,
          schedule.template_key,
          item.title || null,
          item.body || null,
          JSON.stringify(item.metadata || {}),
        ],
      );

      const notificationId = insertResult.rows[0].id;

      // Build templatesByChannel
      const templatesByChannel = {};
      const channels = [];
      for (const ch of item.channels) {
        const normalized = ch === "in_app" ? "inapp" : ch;
        channels.push(normalized);
        templatesByChannel[normalized] = {
          title: item.title || schedule.template_key,
          body: item.body || "",
          bodyFormat: "text",
          ctaText: null,
          actionUrl: null,
        };
      }

      await enqueueNotification({
        notificationId,
        appId: schedule.client_id,
        externalUserId: item.user_id,
        type: schedule.template_key,
        templatesByChannel,
        user: { user_id: item.user_id, ...(item.metadata || {}) },
        actionUrl: null,
        data: item.metadata || {},
        channels,
      });

      successCount++;
    } catch (notifErr) {
      console.error(
        `[schedule-worker] Failed to enqueue notification for user ${item.user_id}:`,
        notifErr.message,
      );
      failCount++;
    }
  }

  // Determine log status
  const total = notifications.length;
  const logStatus =
    total === 0
      ? "success"
      : failCount === 0
        ? "success"
        : successCount === 0
          ? "failed"
          : "partial";

  // Insert execution log
  await client.query(
    `INSERT INTO schedule_execution_logs
       (schedule_id, client_id, triggered_by, status,
        total_recipients, success_count, fail_count)
     VALUES ($1, $2, 'scheduler', $3, $4, $5, $6)`,
    [schedule.id, schedule.client_id, logStatus, total, successCount, failCount],
  );

  // Update the schedule row
  if (schedule.type === "one_time") {
    // One-time → mark completed
    await client.query(
      `UPDATE scheduled_notifications
       SET last_run_at = now(), last_run_status = $2, retry_count = 0,
           status = 'completed', updated_at = now()
       WHERE id = $1`,
      [schedule.id, logStatus],
    );

    console.log(
      `[schedule-worker] One-time schedule ${schedule.id} completed (${successCount}/${total})`,
    );
  } else {
    // Recurring → compute next_run_at
    const nextRunAt = computeNextRun(schedule);

    await client.query(
      `UPDATE scheduled_notifications
       SET last_run_at = now(), last_run_status = $2, retry_count = 0,
           next_run_at = $3, updated_at = now()
       WHERE id = $1`,
      [schedule.id, logStatus, nextRunAt.toISOString()],
    );

    console.log(
      `[schedule-worker] Recurring schedule ${schedule.id}: ${successCount}/${total} sent, next run at ${nextRunAt.toISOString()}`,
    );
  }
}

/**
 * The main poll tick.
 *
 * FIX 2: Uses pool.connect() for a dedicated connection,
 * wraps in BEGIN/COMMIT so FOR UPDATE SKIP LOCKED actually
 * holds locks and prevents duplicate sends.
 */
async function pollTick() {
  const sql = getDb();
  const client = await sql.raw.connect();

  try {
    await client.query("BEGIN");

    const { rows: dueSchedules } = await client.query(
      `SELECT * FROM scheduled_notifications
       WHERE status = 'active' AND next_run_at <= now()
       FOR UPDATE SKIP LOCKED`,
    );

    if (dueSchedules.length === 0) {
      await client.query("COMMIT");
      return;
    }

    console.log(
      `[schedule-worker] Found ${dueSchedules.length} due schedule(s)`,
    );

    for (const schedule of dueSchedules) {
      try {
        await processSchedule(schedule, client);
      } catch (scheduleErr) {
        console.error(
          `[schedule-worker] Unhandled error processing schedule ${schedule.id}:`,
          scheduleErr.message,
        );

        // Try to log the failure (best-effort inside transaction)
        try {
          await client.query(
            `INSERT INTO schedule_execution_logs
               (schedule_id, client_id, triggered_by, status, error_message)
             VALUES ($1, $2, 'scheduler', 'failed', $3)`,
            [schedule.id, schedule.client_id, scheduleErr.message],
          );

          await client.query(
            `UPDATE scheduled_notifications
             SET retry_count = retry_count + 1, updated_at = now()
             WHERE id = $1`,
            [schedule.id],
          );
        } catch (logErr) {
          console.error(
            `[schedule-worker] Failed to log error for ${schedule.id}:`,
            logErr.message,
          );
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[schedule-worker] Poll tick transaction failed:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Start the scheduled notification polling worker.
 *
 * Creates a BullMQ repeatable job that runs on the configured
 * cron interval. Refreshes the interval every 10 minutes from
 * app_settings and re-registers the repeatable job only if the
 * cron has changed.
 *
 * @returns {Promise<Worker>}
 */
async function startScheduledNotificationWorker() {
  const connection = getRedisConnection();
  const queue = new Queue(QUEUE_NAME, { connection });

  // Load initial poll interval from DB
  let currentCron = await getPollIntervalCron();

  // Register the repeatable job (cleans up any stale jobs from restarts)
  await registerPoller(queue, currentCron);

  // Create the worker that processes each poll tick
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await pollTick();
    },
    { connection },
  );

  worker.on("completed", () => {
    // Normal log — only emit at debug level to avoid log spam
  });

  worker.on("failed", (_job, err) => {
    console.error("[schedule-worker] Poll job failed:", err.message);
  });

  worker.on("error", (err) => {
    console.error("[schedule-worker] Worker error:", err.message);
  });

  // ─── FIX 3: Refresh poll interval every 10 minutes ───
  // Only re-registers the repeatable job if the cron value changed.
  const refreshInterval = setInterval(async () => {
    try {
      const newCron = await getPollIntervalCron();
      if (newCron !== currentCron) {
        console.log(
          `[schedule-worker] Poll interval changed: ${currentCron} → ${newCron}`,
        );
        await registerPoller(queue, newCron);
        currentCron = newCron;
      }
    } catch (err) {
      console.error(
        "[schedule-worker] Failed to refresh poll interval:",
        err.message,
      );
    }
  }, CONFIG_REFRESH_MS);

  // Clean up interval on worker close
  worker.on("closing", () => {
    clearInterval(refreshInterval);
  });

  console.log(
    `[workers] scheduled-notification worker started (poll: ${currentCron})`,
  );

  return worker;
}

module.exports = { startScheduledNotificationWorker };
