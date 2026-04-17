const { Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { getWhatsAppProvider } = require("../providers/bootstrap");
const { getDb } = require("../db");
const config = require("../config");
const { resolveWhatsAppSession } = require("../utils/whatsapp-session");

/**
 * WhatsApp worker — custom logic on top of the base pattern.
 *
 * Before calling the provider, we look up the active WhatsApp session
 * for the (appId + entityId) pair and fall back one level to the parent
 * entity when needed. If no active session exists the job is logged as
 * failed and **not** retried (missing session is not transient).
 */
function createWhatsAppWorker() {
  const channel = "whatsapp";
  const queueName = config.queues[channel];
  const workerCfg = config.workers[channel];
  const connection = getRedisConnection();

  const worker = new Worker(
    queueName,
    async (job) => {
      const {
        notificationId,
        appId,
        entityId,
        parentEntityId,
        title,
        body,
        ctaText,
        user,
        actionUrl,
        data,
      } = job.data;

      const attemptNumber = job.attemptsMade + 1;
      const sql = getDb();

      console.log(
        `[whatsapp] Processing ${notificationId} (attempt ${attemptNumber})`,
      );

      // ─── 1. Lookup active WhatsApp session for this entity ───
      const { session, isInherited, resolvedEntityId } = await resolveWhatsAppSession(sql, {
        appId,
        entityId,
        parentEntityId,
      });

      if (!session) {
        const reason = entityId
          ? `No active WhatsApp session for entity "${entityId}"${parentEntityId ? ` or parent "${parentEntityId}"` : ""}`
          : parentEntityId
            ? `No active WhatsApp session for parent entity "${parentEntityId}"`
            : "No entity_id provided — cannot resolve WhatsApp session";

        console.warn(`[whatsapp] ⚠ ${notificationId}: ${reason}`);

        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', 'unknown', ${reason}, ${attemptNumber})
        `;

        await sql`
          UPDATE notifications
          SET status = 'failed'
          WHERE id = ${notificationId}
            AND status != 'delivered'
        `;

        // Return instead of throw — no point retrying a missing session
        return;
      }

      // ─── 2. Send via Meta WhatsApp Cloud API only ───
      const connectionType = session.connection_type || "meta";
      if (connectionType !== "meta") {
        const reason = `Unsupported WhatsApp connection_type "${connectionType}"`;

        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', 'meta-whatsapp', ${reason}, ${attemptNumber})
        `;

        await sql`
          UPDATE notifications
          SET status = 'failed'
          WHERE id = ${notificationId}
            AND status != 'delivered'
        `;

        return;
      }

      if (session.status !== "active") {
        const reason = `WhatsApp session for entity "${entityId || resolvedEntityId}" is not active`;

        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', 'meta-whatsapp', ${reason}, ${attemptNumber})
        `;

        await sql`
          UPDATE notifications
          SET status = 'failed'
          WHERE id = ${notificationId}
            AND status != 'delivered'
        `;

        return;
      }

      const metaProvider = getWhatsAppProvider();

      const metaPayload = {
        notificationId,
        title,
        body,
        ctaText,
        user,
        actionUrl,
        data,
        metaApiKey: session.meta_api_key,
        metaPhoneNumberId: session.meta_phone_number_id,
      };

      const requestLabel = entityId || parentEntityId || resolvedEntityId || "unknown entity";
      const inheritanceLabel = isInherited
        ? entityId
          ? `, inherited from ${resolvedEntityId}`
          : `, fallback parent ${resolvedEntityId}`
        : "";

      console.log(
        `[whatsapp] Using Meta provider for ${notificationId} (entity: ${requestLabel}${inheritanceLabel})`,
      );

      const result = await metaProvider.sendWhatsApp(metaPayload);
      result.provider = metaProvider.name;

      // ─── 3. Log result ───
      if (result.success) {
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, provider_message_id, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'sent', ${result.provider}, ${result.providerMessageId || null}, ${attemptNumber})
        `;

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
          `[whatsapp] ✅ ${notificationId} sent via ${result.provider}`,
        );
      } else {
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', ${result.provider || "meta-whatsapp"}, ${result.error || "Unknown error"}, ${attemptNumber})
        `;

        throw new Error(
          result.error ||
            "meta-whatsapp provider returned failure for whatsapp",
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
    console.log(`[whatsapp] Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    console.error(
      `[whatsapp] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );

    const maxAttempts = workerCfg.retries + 1;
    if (job && job.attemptsMade >= maxAttempts) {
      try {
        const sql = getDb();

        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${job.data.notificationId}, ${channel}, 'permanently_failed', 'meta-whatsapp', ${err.message}, ${job.attemptsMade})
        `;

        await sql`
          UPDATE notifications
          SET status = 'failed'
          WHERE id = ${job.data.notificationId}
            AND status != 'delivered'
        `;

        console.error(
          `[whatsapp] ❌ ${job.data.notificationId} permanently failed after ${maxAttempts} attempts`,
        );
      } catch (logErr) {
        console.error(
          "[whatsapp] Failed to log permanent failure:",
          logErr.message,
        );
      }
    }
  });

  worker.on("error", (err) => {
    console.error("[whatsapp] Worker error:", err.message);
  });

  console.log(
    `[workers] whatsapp worker started (concurrency=${workerCfg.concurrency})`,
  );
  return worker;
}

module.exports = () => createWhatsAppWorker();
