const { Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { registry } = require("../providers/registry");
const { getDb } = require("../db");
const config = require("../config");

/**
 * Create a BullMQ Worker for a given channel.
 *
 * Every worker follows the same pattern:
 *   1. Pick job from queue
 *   2. Call registry.send(channel, payload)
 *   3. Log result to notification_logs
 *   4. Update parent notification status
 *
 * @param {string} channel — push | email | sms | whatsapp | inapp
 * @returns {Worker}
 */
function createChannelWorker(channel) {
  const queueName = config.queues[channel];
  const workerCfg = config.workers[channel];
  const connection = getRedisConnection();

  const worker = new Worker(
    queueName,
    async (job) => {
      const { notificationId, title, body, ctaText, user, actionUrl, data } =
        job.data;

      const attemptNumber = job.attemptsMade + 1;
      console.log(
        `[${channel}] Processing ${notificationId} (attempt ${attemptNumber})`,
      );

      const payload = {
        notificationId,
        title,
        body,
        ctaText,
        user,
        actionUrl,
        data,
      };

      // ─── Send through provider registry ───
      const result = await registry.send(channel, payload);

      // ─── Log the result ───
      const sql = getDb();

      if (result.success) {
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, provider_message_id, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'sent', ${result.provider}, ${result.providerMessageId || null}, ${attemptNumber})
        `;

        // Update master notification status
        await sql`
          UPDATE notifications
          SET status = CASE
            WHEN status = 'pending' THEN 'delivered'
            WHEN status = 'failed'  THEN 'partial'
            ELSE status
          END
          WHERE id = ${notificationId}
        `;

        console.log(
          `[${channel}] ✅ ${notificationId} sent via ${result.provider}`,
        );
      } else {
        // Provider returned success=false but didn't throw — treat as failure
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', ${result.provider || channel}, ${result.error || "Unknown error"}, ${attemptNumber})
        `;

        if (result.retryable === false) {
          await sql`
            UPDATE notifications
            SET status = 'failed'
            WHERE id = ${notificationId}
              AND status != 'delivered'
          `;

          console.warn(
            `[${channel}] ⚠ ${notificationId} non-retryable failure: ${result.error || "Unknown error"}`,
          );
          return;
        }

        // Throw so BullMQ retries the job
        throw new Error(
          result.error || `Provider returned failure for ${channel}`,
        );
      }
    },
    {
      connection,
      concurrency: workerCfg.concurrency,
    },
  );

  // ─── Event handlers ───

  worker.on("completed", (job) => {
    console.log(`[${channel}] Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    console.error(
      `[${channel}] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );

    // If this was the last attempt, mark as permanently_failed
    const maxAttempts = workerCfg.retries + 1;
    if (job && job.attemptsMade >= maxAttempts) {
      try {
        const sql = getDb();
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${job.data.notificationId}, ${channel}, 'permanently_failed', ${channel}, ${err.message}, ${job.attemptsMade})
        `;

        await sql`
          UPDATE notifications
          SET status = 'failed'
          WHERE id = ${job.data.notificationId}
            AND status != 'delivered'
        `;

        console.error(
          `[${channel}] ❌ ${job.data.notificationId} permanently failed after ${maxAttempts} attempts`,
        );
      } catch (logErr) {
        console.error(
          `[${channel}] Failed to log permanent failure:`,
          logErr.message,
        );
      }
    }
  });

  worker.on("error", (err) => {
    console.error(`[${channel}] Worker error:`, err.message);
  });

  console.log(
    `[workers] ${channel} worker started (concurrency=${workerCfg.concurrency})`,
  );
  return worker;
}

module.exports = { createChannelWorker };
