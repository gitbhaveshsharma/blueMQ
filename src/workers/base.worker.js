"use strict";

const { Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { registry } = require("../providers/registry");
const { getAppProvider } = require("../providers/per-app-factory");
const { getDb } = require("../db");
const config = require("../config");
const { settleOnClient } = require("../utils/quota");
const { enqueueWebhookEvent } = require("./webhook-delivery.worker");

/**
 * Create a BullMQ Worker for a given channel.
 *
 * Every worker follows the same pattern:
 *   1. Pick job from queue
 *   2. Resolve provider (per-app credentials → server default)
 *   3. Send via resolved provider
 *   4. In a single DB transaction:
 *        a. INSERT notification_logs
 *        b. UPDATE notifications.status
 *        c. Settle quota reservation (consumed on success, released on terminal failure)
 *   5. On transient failure: throw so BullMQ retries. Reservation stays 'reserved'.
 *
 * @param {string} channel — push | email | sms | whatsapp | call | inapp
 * @returns {Worker}
 */
function createChannelWorker(channel) {
  const queueName = config.queues[channel];
  const workerCfg = config.workers[channel];
  const connection = getRedisConnection();

  const worker = new Worker(
    queueName,
    async (job) => {
      const {
        notificationId,
        appId,
        externalUserId,
        title,
        body,
        bodyFormat,
        ctaText,
        user,
        actionUrl,
        data,
      } = job.data;

      const attemptNumber = job.attemptsMade + 1;
      console.log(
        `[${channel}] Processing ${notificationId} (attempt ${attemptNumber})`,
      );

      const payload = {
        notificationId,
        appId,
        externalUserId,
        title,
        body,
        bodyFormat,
        ctaText,
        user,
        actionUrl,
        data,
      };

      // ─── Resolve provider: per-app credentials → server default ───────────
      const methodMap = {
        push: "sendPush",
        email: "sendEmail",
        sms: "sendSMS",
        whatsapp: "sendWhatsApp",
        call: "sendCall",
        inapp: "sendInApp",
      };
      const method = methodMap[channel];

      let result;
      let providerName;

      if (appId && channel !== "inapp") {
        try {
          const resolved = await getAppProvider(appId, channel);
          providerName = resolved.providerName;
          result = await resolved.provider[method](payload);
          result = { ...result, provider: providerName };
        } catch (providerErr) {
          console.warn(
            `[${channel}] Per-app provider failed for ${appId}, falling back to registry: ${providerErr.message}`,
          );
          result = await registry.send(channel, payload);
          providerName = result.provider;
        }
      } else {
        result = await registry.send(channel, payload);
        providerName = result.provider;
      }

      // ─── Log result + settle quota in ONE transaction ─────────────────────
      const sql = getDb();

      if (result.success) {
        // ── Terminal: success ── consume reservation, log 'sent', update status
        const dbClient = await sql.raw.connect();
        let notifRow;
        try {
          await dbClient.query("BEGIN");

          await dbClient.query(
            `INSERT INTO notification_logs
               (notification_id, channel, status, provider, provider_message_id, attempt_number)
             VALUES ($1, $2, 'sent', $3, $4, $5)`,
            [notificationId, channel, result.provider, result.providerMessageId || null, attemptNumber],
          );

          const updRes = await dbClient.query(
            `UPDATE notifications
             SET status = CASE
               WHEN status = 'pending' THEN 'delivered'
               WHEN status = 'failed'  THEN 'partial'
               ELSE status
             END
             WHERE id = $1
             RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
            [notificationId],
          );
          notifRow = updRes.rows[0];

          // Settle: mark reservation consumed (reserved-- used++)
          await settleOnClient(dbClient, { notificationId, channel, outcome: "consumed" });

          await dbClient.query("COMMIT");
        } catch (txErr) {
          await dbClient.query("ROLLBACK").catch(() => {});
          throw txErr;
        } finally {
          dbClient.release();
        }

        // Fire notification.final if all expected channels have settled
        if (notifRow) {
          await _maybeFireNotificationFinal(sql, notificationId, notifRow).catch((e) =>
            console.warn(`[${channel}] notification.final check failed:`, e.message)
          );
        }

        console.log(
          `[${channel}] ✅ ${notificationId} sent via ${result.provider}`,
        );
      } else {
        // Provider returned success=false but didn't throw

        if (result.retryable === false) {
          // ── Terminal: non-retryable failure ── release reservation, log 'failed'
          const dbClient = await sql.raw.connect();
          let notifRow2;
          try {
            await dbClient.query("BEGIN");

            await dbClient.query(
              `INSERT INTO notification_logs
                 (notification_id, channel, status, provider, error, attempt_number)
               VALUES ($1, $2, 'failed', $3, $4, $5)`,
              [notificationId, channel, result.provider || channel, result.error || "Unknown error", attemptNumber],
            );

            const updRes2 = await dbClient.query(
              `UPDATE notifications
               SET status = 'failed'
               WHERE id = $1 AND status != 'delivered'
               RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
              [notificationId],
            );
            notifRow2 = updRes2.rows[0];

            // Settle: release reservation (not charged)
            await settleOnClient(dbClient, { notificationId, channel, outcome: "released" });

            await dbClient.query("COMMIT");
          } catch (txErr) {
            await dbClient.query("ROLLBACK").catch(() => {});
            throw txErr;
          } finally {
            dbClient.release();
          }

          if (notifRow2) {
            await _maybeFireNotificationFinal(sql, notificationId, notifRow2).catch((e) =>
              console.warn(`[${channel}] notification.final check failed:`, e.message)
            );
          }

          console.warn(
            `[${channel}] ⚠ ${notificationId} non-retryable failure: ${result.error || "Unknown error"}`,
          );
          return; // Do NOT throw — BullMQ will not retry
        }

        // ── Transient failure ── log attempt, keep reservation 'reserved', throw to retry
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', ${result.provider || channel},
             ${result.error || "Unknown error"}, ${attemptNumber})
        `;

        // Throw so BullMQ retries the job. Reservation stays 'reserved'.
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

  // ─── Event handlers ───────────────────────────────────────────────────────

  worker.on("completed", (job) => {
    console.log(`[${channel}] Job ${job.id} completed`);
  });

  // BullMQ fires 'failed' after every attempt. We only act on the FINAL attempt
  // (when attemptsMade >= maxAttempts) to log permanently_failed and settle quota.
  worker.on("failed", async (job, err) => {
    console.error(
      `[${channel}] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );

    const maxAttempts = workerCfg.retries + 1;
    if (job && job.attemptsMade >= maxAttempts) {
      // Final failure: settle reservation as released, log permanently_failed
      try {
        const sql = getDb();
        const dbClient = await sql.raw.connect();
        let notifRowPF;
        try {
          await dbClient.query("BEGIN");

          await dbClient.query(
            `INSERT INTO notification_logs
               (notification_id, channel, status, provider, error, attempt_number)
             VALUES ($1, $2, 'permanently_failed', $3, $4, $5)`,
            [job.data.notificationId, channel, channel, err.message, job.attemptsMade],
          );

          const updPF = await dbClient.query(
            `UPDATE notifications
             SET status = 'failed'
             WHERE id = $1 AND status != 'delivered'
             RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
            [job.data.notificationId],
          );
          notifRowPF = updPF.rows[0];

          // Settle: release reservation — final failure does not consume quota
          await settleOnClient(dbClient, {
            notificationId: job.data.notificationId,
            channel,
            outcome: "released",
          });

          await dbClient.query("COMMIT");
        } catch (txErr) {
          await dbClient.query("ROLLBACK").catch(() => {});
          throw txErr;
        } finally {
          dbClient.release();
        }

        if (notifRowPF) {
          await _maybeFireNotificationFinal(sql, job.data.notificationId, notifRowPF).catch((e) =>
            console.warn(`[${channel}] notification.final check failed:`, e.message)
          );
        }

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

/**
 * Check whether all expected channels have a terminal log entry.
 * If yes, enqueue a `notification.final` webhook event.
 *
 * A channel is "settled" when it has a log entry with status in
 * ('sent', 'failed', 'permanently_failed').
 */
async function _maybeFireNotificationFinal(sql, notificationId, notifRow) {
  if (!notifRow?.app_id) return;

  const expectedChannels = notifRow.expected_channels || [];
  if (expectedChannels.length === 0) return;

  // Count settled channels for this notification
  const settledRes = await sql.query(
    `SELECT DISTINCT channel FROM notification_logs
     WHERE notification_id = $1
       AND status IN ('sent', 'failed', 'permanently_failed')`,
    [notificationId]
  );
  const settledChannels = new Set(settledRes.rows.map((r) => r.channel));

  const allSettled = expectedChannels.every((ch) => settledChannels.has(ch));
  if (!allSettled) return;

  // All channels settled — fire notification.final
  await enqueueWebhookEvent(sql, {
    appId: notifRow.app_id,
    eventType: "notification.final",
    notificationId,
    payload: {
      event: "notification.final",
      notification_id: notificationId,
      status: notifRow.status,
      type: notifRow.type,
      entity_id: notifRow.entity_id,
      parent_entity_id: notifRow.parent_entity_id,
      external_user_id: notifRow.external_user_id,
      settled_channels: [...settledChannels],
      expected_channels: expectedChannels,
      occurred_at: new Date().toISOString(),
    },
  });
}

module.exports = { createChannelWorker, _maybeFireNotificationFinal };
