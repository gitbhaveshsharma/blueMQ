const { Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { registry } = require("../providers/registry");
const { getWhatsAppProvider } = require("../providers/bootstrap");
const { getDb } = require("../db");
const config = require("../config");

/**
 * WhatsApp worker — custom logic on top of the base pattern.
 *
 * Supports two connection types:
 *   - 'waha' (default): Uses WAHA provider with session name
 *   - 'meta': Uses Meta WhatsApp Cloud API with API credentials
 *
 * Before calling the provider, we look up the active WhatsApp session
 * for the (appId + entityId) pair.  If no active session exists the job is
 * logged as failed and **not** retried (missing session is not transient).
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
      const [session] = await sql`
        SELECT waha_session, connection_type, meta_api_key, meta_phone_number_id
        FROM whatsapp_sessions
        WHERE app_id    = ${appId}
          AND entity_id = ${entityId || ""}
          AND status    = 'active'
        LIMIT 1
      `;

      if (!session) {
        const reason = entityId
          ? `No active WhatsApp session for entity "${entityId}"`
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

      // ─── 2. Determine connection type and send via appropriate provider ───
      const connectionType = session.connection_type || "waha";
      let result;

      if (connectionType === "meta") {
        // ─── Meta WhatsApp Cloud API ───
        const metaProvider = getWhatsAppProvider("meta");

        const metaPayload = {
          notificationId,
          title,
          body,
          ctaText,
          user,
          actionUrl,
          data,
          // Meta-specific credentials from session
          metaApiKey: session.meta_api_key,
          metaPhoneNumberId: session.meta_phone_number_id,
        };

        console.log(
          `[whatsapp] Using Meta provider for ${notificationId} (entity: ${entityId})`,
        );
        result = await metaProvider.sendWhatsApp(metaPayload);
        result.provider = metaProvider.name;
      } else {
        // ─── WAHA (default) ───
        const wahaPayload = {
          notificationId,
          title,
          body,
          ctaText,
          user,
          actionUrl,
          data,
          session: session.waha_session,
        };

        console.log(
          `[whatsapp] Using WAHA provider for ${notificationId} (session: ${session.waha_session})`,
        );
        result = await registry.send(channel, wahaPayload);
      }

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
            (${notificationId}, ${channel}, 'failed', ${result.provider || connectionType}, ${result.error || "Unknown error"}, ${attemptNumber})
        `;

        throw new Error(
          result.error ||
            `${connectionType} provider returned failure for whatsapp`,
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

        // Determine provider from job data if possible
        const entityId = job.data.entityId;
        let providerName = "unknown";

        try {
          const [session] = await sql`
            SELECT connection_type FROM whatsapp_sessions
            WHERE app_id = ${job.data.appId} AND entity_id = ${entityId || ""}
            LIMIT 1
          `;
          providerName =
            session?.connection_type === "meta" ? "meta-whatsapp" : "waha";
        } catch {
          // Ignore lookup errors
        }

        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${job.data.notificationId}, ${channel}, 'permanently_failed', ${providerName}, ${err.message}, ${job.attemptsMade})
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
