const { Queue, Worker } = require("bullmq");
const { getRedisConnection } = require("../queues/connection");
const { getDb } = require("../db");
const { getPollIntervalCron } = require("../utils/config-resolver.util");
const { computeNextRun } = require("../utils/compute-next-run.util");
const { renderTemplate } = require("../utils/template");
const {
  normalizePublicChannel,
  normalizePublicChannels,
  getTemplateChannelCandidates,
  toInternalChannel,
  toInternalChannels,
} = require("../utils/channel");
const { normalizeEntityId } = require("../utils/whatsapp-session");
const { signRequest } = require("../utils/hmac.util");
const { enqueueNotification } = require("../queues/enqueue");

const QUEUE_NAME = "scheduled-notification-poller";
const STABLE_JOB_ID = "scheduled-notification-poll";
const CONFIG_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

function normalizeComparable(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function templateMatchesCondition(template, variables) {
  const conditionKey = normalizeComparable(template.condition_key);
  const conditionValue = normalizeComparable(template.condition_value);

  if (!conditionKey && !conditionValue) {
    return { matches: true, score: 0 };
  }

  const variableEntry = Object.entries(variables || {}).find(
    ([key]) => normalizeComparable(key) === conditionKey,
  );
  const variableValue = normalizeComparable(variableEntry?.[1]);
  if (!variableValue) {
    return { matches: false, score: -1 };
  }

  return variableValue === conditionValue
    ? { matches: true, score: 2 }
    : { matches: false, score: -1 };
}

function pickBestTemplate(templates, variables) {
  let best = null;
  let bestScore = -1;

  for (const template of templates) {
    const { matches, score } = templateMatchesCondition(template, variables);
    if (!matches) continue;

    if (score > bestScore) {
      best = template;
      bestScore = score;
      if (bestScore === 2) {
        break;
      }
    }
  }

  return best;
}

function resolveTemplateVariables(item) {
  if (item?.variables && typeof item.variables === "object") {
    return item.variables;
  }
  if (item?.metadata && typeof item.metadata === "object") {
    return item.metadata;
  }
  if (item?.data && typeof item.data === "object") {
    return item.data;
  }
  return {};
}

function resolvePayloadData(item) {
  if (item?.data && typeof item.data === "object") {
    return item.data;
  }
  if (item?.metadata && typeof item.metadata === "object") {
    return item.metadata;
  }
  if (item?.variables && typeof item.variables === "object") {
    return item.variables;
  }
  return {};
}

async function loadTemplatesForSchedule(schedule, notifications, client) {
  const requestedChannels = new Set();
  for (const item of notifications) {
    const normalized = normalizePublicChannels(item?.channels);
    for (const channel of normalized) {
      requestedChannels.add(channel);
    }
  }

  const templateCandidates = [
    ...new Set(
      [...requestedChannels].flatMap((channel) =>
        getTemplateChannelCandidates(channel),
      ),
    ),
  ];

  if (templateCandidates.length === 0) {
    return {};
  }

  const { rows: templates } = await client.query(
    `SELECT
       channel,
       title,
       body,
       body_format,
       cta_text,
       cta_url,
       condition_key,
       condition_value,
       variant_key
     FROM templates
     WHERE app_id = $1
       AND type = $2
       AND channel = ANY($3)
       AND is_active = true
     ORDER BY channel ASC, updated_at DESC`,
    [schedule.client_id, schedule.template_key, templateCandidates],
  );

  const templateRowsByChannel = {};
  for (const tpl of templates) {
    const normalizedTemplateChannel = normalizePublicChannel(tpl.channel);
    if (!normalizedTemplateChannel) {
      continue;
    }
    if (!templateRowsByChannel[normalizedTemplateChannel]) {
      templateRowsByChannel[normalizedTemplateChannel] = [];
    }
    templateRowsByChannel[normalizedTemplateChannel].push(tpl);
  }

  return templateRowsByChannel;
}

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
      // console.log("[schedule-worker] Removed old repeatable job");
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

  // console.log(
  //   `[schedule-worker] Registered poll job with cron: ${intervalCron}`,
  // );
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
  const requestPayload = {
    schedule_id: schedule.id,
    client_id: schedule.client_id,
    template_key: schedule.template_key,
    triggered_at: new Date().toISOString(),
    audience: schedule.audience || null,
  };
  const requestBody = JSON.stringify(requestPayload);

  const signature = signRequest(schedule.data_source_secret, requestBody);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // console.log(
    //   `[schedule-worker] Calling data_source_url for ${schedule.id}: ${requestBody}`,
    // );

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

    // console.log(
    //   `[schedule-worker] data_source_url response for ${schedule.id}: ${JSON.stringify(data)}`,
    // );

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
  const templateRowsByChannel = await loadTemplatesForSchedule(
    schedule,
    notifications,
    client,
  );
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

      const normalizedChannels = normalizePublicChannels(item.channels);
      if (normalizedChannels.length === 0) {
        console.warn(
          `[schedule-worker] Skipping invalid channels in schedule ${schedule.id}`,
        );
        failCount++;
        continue;
      }

      const templateVariables = resolveTemplateVariables(item);
      const payloadData = resolvePayloadData(item);
      const metadata =
        item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const userFields =
        item.user && typeof item.user === "object" ? item.user : {};
      const payloadUser = {
        user_id: item.user_id,
        ...metadata,
        ...userFields,
      };
      const actionUrl = item.action_url || item.actionUrl || null;
      const resolvedEntityId = normalizeEntityId(item.entity_id);
      const resolvedParentEntityId = normalizeEntityId(item.parent_entity_id);

      const templateMap = {};
      for (const channel of normalizedChannels) {
        const channelTemplates = templateRowsByChannel[channel] || [];
        const selectedTemplate = pickBestTemplate(
          channelTemplates,
          templateVariables,
        );

        if (selectedTemplate) {
          templateMap[channel] = {
            title: renderTemplate(selectedTemplate.title, templateVariables),
            body: renderTemplate(selectedTemplate.body, templateVariables),
            bodyFormat: selectedTemplate.body_format || "text",
            ctaText: renderTemplate(
              selectedTemplate.cta_text,
              templateVariables,
            ),
            actionUrl: renderTemplate(
              selectedTemplate.cta_url,
              templateVariables,
            ),
          };
        } else {
          templateMap[channel] = {
            title:
              item.title ||
              templateVariables?.title ||
              schedule.template_key.replace(/_/g, " "),
            body:
              item.body ||
              templateVariables?.body ||
              templateVariables?.message ||
              `Notification: ${schedule.template_key}`,
            bodyFormat: "text",
            ctaText: templateVariables?.cta_text || null,
            actionUrl: templateVariables?.cta_url || null,
          };
        }
      }

      const primaryTemplate = templateMap[normalizedChannels[0]];
      const primaryActionUrl = primaryTemplate?.actionUrl || actionUrl || null;

      // Insert master notification row
      const insertResult = await client.query(
        `INSERT INTO notifications
           (app_id, external_user_id, type, title, message, data, action_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id`,
        [
          schedule.client_id,
          item.user_id,
          schedule.template_key,
          primaryTemplate?.title || null,
          primaryTemplate?.body || null,
          JSON.stringify(payloadData),
          primaryActionUrl,
        ],
      );

      const notificationId = insertResult.rows[0].id;

      // Build templatesByChannel
      const templatesByChannel = {};
      for (const channel of normalizedChannels) {
        const internalChannel = toInternalChannel(channel);
        if (!internalChannel) {
          continue;
        }
        templatesByChannel[internalChannel] = {
          ...templateMap[channel],
          actionUrl: templateMap[channel]?.actionUrl || actionUrl || null,
        };
      }

      await enqueueNotification({
        notificationId,
        appId: schedule.client_id,
        externalUserId: item.user_id,
        type: schedule.template_key,
        templatesByChannel,
        user: payloadUser,
        actionUrl: primaryActionUrl,
        data: payloadData,
        channels: toInternalChannels(normalizedChannels),
        entityId: resolvedEntityId,
        parentEntityId: resolvedParentEntityId,
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
    [
      schedule.id,
      schedule.client_id,
      logStatus,
      total,
      successCount,
      failCount,
    ],
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

    // console.log(
    //   `[schedule-worker] One-time schedule ${schedule.id} completed (${successCount}/${total})`,
    // );
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

    // console.log(
    //   `[schedule-worker] Recurring schedule ${schedule.id}: ${successCount}/${total} sent, next run at ${nextRunAt.toISOString()}`,
    // );
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

    // console.log(
    //   `[schedule-worker] Found ${dueSchedules.length} due schedule(s)`,
    // );

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
    console.error(
      "[schedule-worker] Poll tick transaction failed:",
      err.message,
    );
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
        // console.log(
        //   `[schedule-worker] Poll interval changed: ${currentCron} → ${newCron}`,
        // );
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

  // console.log(
  //   `[workers] scheduled-notification worker started (poll: ${currentCron})`,
  // );

  return worker;
}

module.exports = { startScheduledNotificationWorker };
