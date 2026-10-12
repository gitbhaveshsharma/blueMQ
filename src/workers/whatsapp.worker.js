const { Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { getWhatsAppProvider } = require("../providers/bootstrap");
const { getAppProvider } = require("../providers/per-app-factory");
const { getDb } = require("../db");
const config = require("../config");
const { resolveWhatsAppSession } = require("../utils/whatsapp-session");
const {
  inferCacheStatusFromMetaError,
  markCacheStatus,
  summarizeWhatsAppTemplate,
} = require("../utils/whatsapp-template");
const { settleOnClient } = require("../utils/quota");
const { _maybeFireNotificationFinal } = require("./base.worker");

/**
 * WhatsApp worker — custom logic on top of the base pattern.
 *
 * This worker supports provider routing:
 * - MSG91: direct send (no entity session required)
 * - Meta: resolves entity/parent session before calling Meta API.
 *
 * For Meta, if no active session exists the job is logged as failed and
 * not retried (missing session is not transient).
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
        bodyFormat,
        ctaText,
        user,
        actionUrl,
        data,
        templateName,
        language,
        parameters,
      } = job.data;

      const attemptNumber = job.attemptsMade + 1;
      const sql = getDb();

      console.log(
        `[whatsapp] Processing ${notificationId} (attempt ${attemptNumber})`,
      );
      console.info(
        `[whatsapp] Payload summary ${JSON.stringify({
          notification_id: notificationId,
          app_id: appId,
          entity_id: entityId || null,
          parent_entity_id: parentEntityId || null,
          ...summarizeWhatsAppTemplate({ templateName, language, parameters }),
        })}`,
      );

      const basePayload = {
        notificationId,
        title,
        body,
        bodyFormat,
        ctaText,
        user,
        actionUrl,
        data,
        templateName,
        language,
        parameters,
      };

      let resolvedProvider;
      let providerName;

      if (appId) {
        const resolved = await getAppProvider(appId, "whatsapp");
        resolvedProvider = resolved.provider;
        providerName = resolved.providerName || resolved.provider?.name;
      } else {
        resolvedProvider = getWhatsAppProvider();
        providerName = resolvedProvider.name;
      }

      const normalizedProviderName = String(providerName || "")
        .trim()
        .toLowerCase();
      const isMetaProvider =
        normalizedProviderName === "meta" ||
        normalizedProviderName === "meta-whatsapp";

      let result;

      if (!isMetaProvider) {
        result = await resolvedProvider.sendWhatsApp(basePayload);
        result.provider = providerName || resolvedProvider.name || "unknown";
      } else {
        // ─── 1. Lookup active WhatsApp session for this entity ───
        const {
          session,
          isInherited,
          resolvedEntityId,
          fallbackUsed,
          resolutionSource,
        } = await resolveWhatsAppSession(sql, {
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

          // Terminal: non-retryable. Settle + log + update in one transaction.
          const dbClient1 = await sql.raw.connect();
          let notifRow1;
          try {
            await dbClient1.query("BEGIN");
            await dbClient1.query(
              `INSERT INTO notification_logs
                 (notification_id, channel, status, provider, error, attempt_number)
               VALUES ($1, $2, 'failed', 'meta-whatsapp', $3, $4)`,
              [notificationId, channel, reason, attemptNumber],
            );
            const upd1 = await dbClient1.query(
              `UPDATE notifications SET status = 'failed'
               WHERE id = $1 AND status != 'delivered'
               RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
              [notificationId],
            );
            notifRow1 = upd1.rows[0];
            await settleOnClient(dbClient1, {
              notificationId,
              channel,
              outcome: "released",
            });
            await dbClient1.query("COMMIT");
          } catch (txErr) {
            await dbClient1.query("ROLLBACK").catch(() => {});
            throw txErr;
          } finally {
            dbClient1.release();
          }

          if (notifRow1) {
            await _maybeFireNotificationFinal(
              sql,
              notificationId,
              notifRow1,
            ).catch((e) =>
              console.warn(
                `[whatsapp] notification.final check failed:`,
                e.message,
              ),
            );
          }

          // Return instead of throw — no point retrying a missing session
          return;
        }

        // ─── 2. Send via Meta WhatsApp Cloud API ───
        const connectionType = session.connection_type || "meta";
        if (connectionType !== "meta") {
          const reason = `Unsupported WhatsApp connection_type "${connectionType}"`;

          const dbClient2 = await sql.raw.connect();
          let notifRow2;
          try {
            await dbClient2.query("BEGIN");
            await dbClient2.query(
              `INSERT INTO notification_logs
                 (notification_id, channel, status, provider, error, attempt_number)
               VALUES ($1, $2, 'failed', 'meta-whatsapp', $3, $4)`,
              [notificationId, channel, reason, attemptNumber],
            );
            const upd2 = await dbClient2.query(
              `UPDATE notifications SET status = 'failed'
               WHERE id = $1 AND status != 'delivered'
               RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
              [notificationId],
            );
            notifRow2 = upd2.rows[0];
            await settleOnClient(dbClient2, {
              notificationId,
              channel,
              outcome: "released",
            });
            await dbClient2.query("COMMIT");
          } catch (txErr) {
            await dbClient2.query("ROLLBACK").catch(() => {});
            throw txErr;
          } finally {
            dbClient2.release();
          }

          if (notifRow2) {
            await _maybeFireNotificationFinal(
              sql,
              notificationId,
              notifRow2,
            ).catch((e) =>
              console.warn(
                `[whatsapp] notification.final check failed:`,
                e.message,
              ),
            );
          }

          return;
        }

        if (session.status !== "active") {
          const reason = `WhatsApp session for entity "${entityId || resolvedEntityId}" is not active`;

          const dbClient3 = await sql.raw.connect();
          let notifRow3;
          try {
            await dbClient3.query("BEGIN");
            await dbClient3.query(
              `INSERT INTO notification_logs
                 (notification_id, channel, status, provider, error, attempt_number)
               VALUES ($1, $2, 'failed', 'meta-whatsapp', $3, $4)`,
              [notificationId, channel, reason, attemptNumber],
            );
            const upd3 = await dbClient3.query(
              `UPDATE notifications SET status = 'failed'
               WHERE id = $1 AND status != 'delivered'
               RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
              [notificationId],
            );
            notifRow3 = upd3.rows[0];
            await settleOnClient(dbClient3, {
              notificationId,
              channel,
              outcome: "released",
            });
            await dbClient3.query("COMMIT");
          } catch (txErr) {
            await dbClient3.query("ROLLBACK").catch(() => {});
            throw txErr;
          } finally {
            dbClient3.release();
          }

          if (notifRow3) {
            await _maybeFireNotificationFinal(
              sql,
              notificationId,
              notifRow3,
            ).catch((e) =>
              console.warn(
                `[whatsapp] notification.final check failed:`,
                e.message,
              ),
            );
          }

          return;
        }

        const metaPayload = {
          ...basePayload,
          metaApiKey: session.meta_api_key,
          metaPhoneNumberId: session.meta_phone_number_id,
        };

        const requestLabel =
          entityId || parentEntityId || resolvedEntityId || "unknown entity";
        const inheritanceLabel = isInherited
          ? entityId
            ? `, inherited from ${resolvedEntityId}`
            : `, fallback parent ${resolvedEntityId}`
          : "";

        if (fallbackUsed) {
          console.warn(
            `[whatsapp] Using app fallback session "${resolvedEntityId}" for ${notificationId} (requested entity: ${requestLabel})`,
          );
        }

        console.log(
          `[whatsapp] Using Meta provider for ${notificationId} (entity: ${requestLabel}${inheritanceLabel}, source: ${resolutionSource || "unknown"})`,
        );

        result = await resolvedProvider.sendWhatsApp(metaPayload);
        result.provider = resolvedProvider.name;

        if (
          !result.success &&
          templateName &&
          language &&
          (resolvedEntityId || entityId)
        ) {
          const nextStatus = inferCacheStatusFromMetaError(
            result.errorCode,
            result.errorMessage || result.error,
          );
          if (nextStatus) {
            await markCacheStatus({
              appId,
              entityId: resolvedEntityId || entityId,
              name: templateName,
              language,
              status: nextStatus,
            });
          }
        }
      }

      // ─── 3. Log result + settle quota in ONE transaction ─────────────────
      if (result.success) {
        const dbClientS = await sql.raw.connect();
        let notifRowS;
        try {
          await dbClientS.query("BEGIN");
          await dbClientS.query(
            `INSERT INTO notification_logs
               (notification_id, channel, status, provider, provider_message_id, attempt_number)
             VALUES ($1, $2, 'sent', $3, $4, $5)`,
            [
              notificationId,
              channel,
              result.provider,
              result.providerMessageId || null,
              attemptNumber,
            ],
          );
          const updS = await dbClientS.query(
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
          notifRowS = updS.rows[0];
          await settleOnClient(dbClientS, {
            notificationId,
            channel,
            outcome: "consumed",
          });
          await dbClientS.query("COMMIT");
        } catch (txErr) {
          await dbClientS.query("ROLLBACK").catch(() => {});
          throw txErr;
        } finally {
          dbClientS.release();
        }
        if (notifRowS) {
          await _maybeFireNotificationFinal(
            sql,
            notificationId,
            notifRowS,
          ).catch((e) =>
            console.warn(
              `[whatsapp] notification.final check failed:`,
              e.message,
            ),
          );
        }
        console.log(
          `[whatsapp] ✅ ${notificationId} sent via ${result.provider}`,
        );
      } else {
        if (result.retryable === false) {
          // Terminal: non-retryable failure — settle as released
          const dbClientF = await sql.raw.connect();
          let notifRowF;
          try {
            await dbClientF.query("BEGIN");
            await dbClientF.query(
              `INSERT INTO notification_logs
                 (notification_id, channel, status, provider, error, attempt_number)
               VALUES ($1, $2, 'failed', $3, $4, $5)`,
              [
                notificationId,
                channel,
                result.provider || "unknown",
                result.error || "Unknown error",
                attemptNumber,
              ],
            );
            const updF = await dbClientF.query(
              `UPDATE notifications SET status = 'failed'
               WHERE id = $1 AND status != 'delivered'
               RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
              [notificationId],
            );
            notifRowF = updF.rows[0];
            await settleOnClient(dbClientF, {
              notificationId,
              channel,
              outcome: "released",
            });
            await dbClientF.query("COMMIT");
          } catch (txErr) {
            await dbClientF.query("ROLLBACK").catch(() => {});
            throw txErr;
          } finally {
            dbClientF.release();
          }
          if (notifRowF) {
            await _maybeFireNotificationFinal(
              sql,
              notificationId,
              notifRowF,
            ).catch((e) =>
              console.warn(
                `[whatsapp] notification.final check failed:`,
                e.message,
              ),
            );
          }
          return;
        }

        if (
          result.errorCode === 132000 ||
          (result.error && result.error.includes("132000"))
        ) {
          console.error(
            `[whatsapp] ❌ [PARAMETER MISMATCH] Template "${templateName}" parameter count does not match Meta template definition for job ${notificationId}:`,
            JSON.stringify(
              {
                notification_id: notificationId,
                template_name: templateName,
                language,
                parameters_sent: metaPayload.parameters,
                meta_error: result.error,
                meta_error_data: result.errorData,
              },
              null,
              2,
            ),
          );
        }

        // Transient failure — log attempt, keep reservation 'reserved', throw to retry
        await sql`
          INSERT INTO notification_logs
            (notification_id, channel, status, provider, error, attempt_number)
          VALUES
            (${notificationId}, ${channel}, 'failed', ${result.provider || "unknown"},
             ${result.error || "Unknown error"}, ${attemptNumber})
        `;
        throw new Error(
          result.error || "provider returned failure for whatsapp",
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
      // Final failure: settle + log permanently_failed in one transaction
      try {
        const sql = getDb();
        const dbClientPF = await sql.raw.connect();
        let notifRowPF;
        try {
          await dbClientPF.query("BEGIN");
          await dbClientPF.query(
            `INSERT INTO notification_logs
               (notification_id, channel, status, provider, error, attempt_number)
             VALUES ($1, $2, 'permanently_failed', 'whatsapp', $3, $4)`,
            [job.data.notificationId, channel, err.message, job.attemptsMade],
          );
          const updPF = await dbClientPF.query(
            `UPDATE notifications SET status = 'failed'
             WHERE id = $1 AND status != 'delivered'
             RETURNING app_id, status, expected_channels, entity_id, parent_entity_id, external_user_id, type`,
            [job.data.notificationId],
          );
          notifRowPF = updPF.rows[0];
          await settleOnClient(dbClientPF, {
            notificationId: job.data.notificationId,
            channel,
            outcome: "released",
          });
          await dbClientPF.query("COMMIT");
        } catch (txErr) {
          await dbClientPF.query("ROLLBACK").catch(() => {});
          throw txErr;
        } finally {
          dbClientPF.release();
        }
        if (notifRowPF) {
          await _maybeFireNotificationFinal(
            sql,
            job.data.notificationId,
            notifRowPF,
          ).catch((e) =>
            console.warn(
              `[whatsapp] notification.final check failed:`,
              e.message,
            ),
          );
        }
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
