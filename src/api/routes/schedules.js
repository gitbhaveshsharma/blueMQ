const { Router } = require("express");
const { getDb } = require("../../db");
const { authMiddleware } = require("../middlewares/auth");
const { resolveScheduleConfig } = require("../../utils/config-resolver.util");
const {
  computeNextRun,
  computeInitialNextRun,
} = require("../../utils/compute-next-run.util");
const { renderTemplate } = require("../../utils/template");
const {
  normalizePublicChannel,
  normalizePublicChannels,
  getTemplateChannelCandidates,
  toInternalChannel,
  toInternalChannels,
} = require("../../utils/channel");
const { normalizeEntityId } = require("../../utils/whatsapp-session");
const { signRequest } = require("../../utils/hmac.util");
const { enqueueNotification } = require("../../queues/enqueue");

const router = Router();

// ─── Helpers ───────────────────────────────────────────────

const VALID_TYPES = ["one_time", "recurring"];
const VALID_FREQUENCIES = ["daily", "weekly", "monthly", "custom_cron"];
const VALID_STATUSES = ["active", "paused", "completed", "failed"];

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

/**
 * Strip data_source_secret from a schedule object before
 * returning it in any API response. data_source_secret is
 * write-only — never returned after creation.
 */
function sanitizeSchedule(schedule) {
  if (!schedule) return schedule;
  const { data_source_secret, ...safe } = schedule;
  return safe;
}

/**
 * Call a data_source_url with HMAC-signed headers and an
 * 8-second timeout. Returns the parsed JSON body.
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
    console.log(
      `[schedules] Calling data_source_url for ${schedule.id}: ${requestBody}`,
    );

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

    console.log(
      `[schedules] data_source_url response for ${schedule.id}: ${JSON.stringify(data)}`,
    );

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
 * Process notifications from a data_source_url response:
 * insert notification rows and enqueue for delivery.
 *
 * Returns { total, successCount, failCount }.
 */
async function processNotifications(notifications, schedule) {
  const sql = getDb();
  let successCount = 0;
  let failCount = 0;

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

  let templateRowsByChannel = {};
  if (templateCandidates.length > 0) {
    const templates = await sql`
      SELECT
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
      WHERE app_id = ${schedule.client_id}
        AND type = ${schedule.template_key}
        AND channel = ANY(${templateCandidates})
        AND is_active = true
      ORDER BY channel ASC, updated_at DESC
    `;

    templateRowsByChannel = {};
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
  }

  for (const item of notifications) {
    try {
      if (!item.user_id || !item.channels || !Array.isArray(item.channels)) {
        console.warn(
          `[schedules] Skipping invalid notification item in schedule ${schedule.id}`,
        );
        failCount++;
        continue;
      }

      const normalizedChannels = normalizePublicChannels(item.channels);
      if (normalizedChannels.length === 0) {
        console.warn(
          `[schedules] Skipping invalid channels in schedule ${schedule.id}`,
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

      // Insert the master notification row
      const rows = await sql`
        INSERT INTO notifications
          (app_id, external_user_id, type, title, message, data, action_url, status)
        VALUES
          (${schedule.client_id}, ${item.user_id}, ${schedule.template_key},
           ${primaryTemplate?.title || null},
           ${primaryTemplate?.body || null},
           ${JSON.stringify(payloadData)},
           ${primaryActionUrl}, 'pending')
        RETURNING id
      `;

      const notificationId = rows[0].id;

      // Build templatesByChannel — same content for every channel
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

      const channels = toInternalChannels(normalizedChannels);

      await enqueueNotification({
        notificationId,
        appId: schedule.client_id,
        externalUserId: item.user_id,
        type: schedule.template_key,
        templatesByChannel,
        user: payloadUser,
        actionUrl: primaryActionUrl,
        data: payloadData,
        channels,
        entityId: resolvedEntityId,
        parentEntityId: resolvedParentEntityId,
      });

      successCount++;
    } catch (err) {
      console.error(
        `[schedules] Failed to process notification for user ${item.user_id}:`,
        err.message,
      );
      failCount++;
    }
  }

  return { total: notifications.length, successCount, failCount };
}

// ─────────────────────────────────────────────────────────────
//  POST /schedules — Create a new schedule
// ─────────────────────────────────────────────────────────────
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      type,
      template_key,
      data_source_url,
      data_source_secret,
      audience,
      frequency,
      cron_expression,
      day_of_month,
      day_of_week,
      time_of_day,
      timezone,
      run_at,
      created_by,
      max_retries,
    } = req.body;

    // ─── Validation ───
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type is required and must be one of: ${VALID_TYPES.join(", ")}`,
      });
    }
    if (!template_key || typeof template_key !== "string") {
      return res.status(400).json({ error: "template_key is required" });
    }
    if (!data_source_url || typeof data_source_url !== "string") {
      return res.status(400).json({ error: "data_source_url is required" });
    }
    if (!data_source_secret || typeof data_source_secret !== "string") {
      return res.status(400).json({ error: "data_source_secret is required" });
    }
    if (!audience || typeof audience !== "object") {
      return res
        .status(400)
        .json({ error: "audience is required and must be an object or array" });
    }

    // one_time validation
    if (type === "one_time") {
      if (!run_at) {
        return res
          .status(400)
          .json({ error: "run_at is required for one_time schedules" });
      }
      if (new Date(run_at) <= new Date()) {
        return res
          .status(400)
          .json({ error: "run_at must be a future datetime" });
      }
    }

    // recurring validation
    if (type === "recurring") {
      if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
        return res.status(400).json({
          error: `frequency is required for recurring schedules. Must be one of: ${VALID_FREQUENCIES.join(", ")}`,
        });
      }

      if (frequency === "custom_cron" && !cron_expression) {
        return res.status(400).json({
          error: "cron_expression is required for custom_cron frequency",
        });
      }

      if (
        (frequency === "daily" ||
          frequency === "weekly" ||
          frequency === "monthly") &&
        !time_of_day
      ) {
        return res.status(400).json({
          error: "time_of_day is required for daily/weekly/monthly frequency",
        });
      }

      if (
        frequency === "weekly" &&
        (day_of_week === undefined || day_of_week === null)
      ) {
        return res.status(400).json({
          error: "day_of_week (0-6, 0=Sunday) is required for weekly frequency",
        });
      }

      if (frequency === "monthly" && !day_of_month) {
        return res.status(400).json({
          error: "day_of_month (1-28) is required for monthly frequency",
        });
      }

      if (day_of_month !== undefined && day_of_month !== null) {
        if (day_of_month < 1 || day_of_month > 28) {
          return res
            .status(400)
            .json({ error: "day_of_month must be between 1 and 28" });
        }
      }
    }

    // ─── Resolve config from hierarchy ───
    const config = await resolveScheduleConfig(req.appId, {
      max_retries: max_retries,
      timezone: timezone,
    });

    // ─── Compute initial next_run_at ───
    const nextRunAt = computeInitialNextRun({
      type,
      frequency,
      cron_expression,
      day_of_month,
      day_of_week,
      time_of_day,
      timezone: config.timezone,
      run_at,
    });

    // ─── Insert ───
    const sql = getDb();
    const rows = await sql`
      INSERT INTO scheduled_notifications
        (client_id, created_by, type, template_key, data_source_url,
         data_source_secret, audience, frequency, cron_expression,
         day_of_month, day_of_week, time_of_day, timezone, run_at,
         next_run_at, max_retries, status)
      VALUES
        (${req.appId}, ${created_by || null}, ${type}, ${template_key},
         ${data_source_url}, ${data_source_secret},
         ${JSON.stringify(audience)}, ${frequency || null},
         ${cron_expression || null}, ${day_of_month || null},
         ${day_of_week !== undefined && day_of_week !== null ? day_of_week : null},
         ${time_of_day || null}, ${config.timezone},
         ${run_at ? new Date(run_at).toISOString() : null},
         ${nextRunAt.toISOString()}, ${config.max_retries}, 'active')
      RETURNING *
    `;

    console.log(
      `[schedules] Created ${type} schedule ${rows[0].id} for app ${req.appId}`,
    );

    return res.status(201).json({
      success: true,
      data: sanitizeSchedule(rows[0]),
    });
  } catch (err) {
    console.error("[schedules] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /schedules — List schedules for this client
// ─────────────────────────────────────────────────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();
    const { status, type } = req.query;

    const params = [req.appId];
    const conditions = ["client_id = $1"];

    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (type && VALID_TYPES.includes(type)) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const where = conditions.join(" AND ");
    const result = await sql.query(
      `SELECT * FROM scheduled_notifications
       WHERE ${where}
       ORDER BY created_at DESC`,
      params,
    );

    return res.json({
      success: true,
      data: (result.rows || []).map(sanitizeSchedule),
    });
  } catch (err) {
    console.error("[schedules] GET list error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /schedules/:id — Get a single schedule
// ─────────────────────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM scheduled_notifications
      WHERE id = ${req.params.id} AND client_id = ${req.appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    return res.json({
      success: true,
      data: sanitizeSchedule(rows[0]),
    });
  } catch (err) {
    console.error("[schedules] GET :id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /schedules/:id — Update a schedule
// ─────────────────────────────────────────────────────────────
router.patch("/:id", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();

    // Verify ownership
    const existing = await sql`
      SELECT * FROM scheduled_notifications
      WHERE id = ${req.params.id} AND client_id = ${req.appId}
      LIMIT 1
    `;

    if (existing.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    const schedule = existing[0];
    const updates = {};
    const body = req.body;

    // Allowed fields
    const directFields = [
      "template_key",
      "data_source_url",
      "data_source_secret",
      "created_by",
      "max_retries",
    ];

    for (const field of directFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.audience !== undefined) {
      updates.audience = JSON.stringify(body.audience);
    }

    // Status changes (pause / resume)
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
        });
      }
      updates.status = body.status;
    }

    // Timing fields that trigger next_run_at recompute
    const timingFields = [
      "frequency",
      "cron_expression",
      "day_of_month",
      "day_of_week",
      "time_of_day",
      "timezone",
      "run_at",
    ];

    let timingChanged = false;
    for (const field of timingFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
        timingChanged = true;
      }
    }

    // Validate day_of_month if provided
    if (body.day_of_month !== undefined && body.day_of_month !== null) {
      if (body.day_of_month < 1 || body.day_of_month > 28) {
        return res
          .status(400)
          .json({ error: "day_of_month must be between 1 and 28" });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    // Recompute next_run_at if timing fields changed
    if (timingChanged) {
      const merged = { ...schedule, ...updates };
      try {
        const nextRunAt = computeInitialNextRun({
          type: merged.type,
          frequency: merged.frequency,
          cron_expression: merged.cron_expression,
          day_of_month: merged.day_of_month,
          day_of_week: merged.day_of_week,
          time_of_day: merged.time_of_day,
          timezone: merged.timezone,
          run_at: merged.run_at,
        });
        updates.next_run_at = nextRunAt.toISOString();
      } catch (computeErr) {
        return res
          .status(400)
          .json({ error: `Invalid schedule timing: ${computeErr.message}` });
      }
    }

    updates.updated_at = "now()";

    // Build dynamic UPDATE query
    const setClauses = [];
    const values = [req.params.id];

    for (const [col, val] of Object.entries(updates)) {
      if (val === "now()") {
        setClauses.push(`${col} = now()`);
      } else {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    }

    const query = `
      UPDATE scheduled_notifications
      SET ${setClauses.join(", ")}
      WHERE id = $1
      RETURNING *
    `;

    const result = await sql.query(query, values);

    console.log(
      `[schedules] Updated schedule ${req.params.id} for app ${req.appId}`,
    );

    return res.json({
      success: true,
      data: sanitizeSchedule(result.rows[0]),
    });
  } catch (err) {
    console.error("[schedules] PATCH error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /schedules/:id — Delete a schedule
// ─────────────────────────────────────────────────────────────
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();
    const rows = await sql`
      DELETE FROM scheduled_notifications
      WHERE id = ${req.params.id} AND client_id = ${req.appId}
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    console.log(
      `[schedules] Deleted schedule ${req.params.id} for app ${req.appId}`,
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[schedules] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /schedules/:id/trigger — Manual trigger (FULLY ISOLATED)
//
//  FIX 6: This endpoint ONLY calls data_source_url, enqueues
//  notifications, and inserts a log row. It NEVER touches
//  retry_count, last_run_status, last_run_at, next_run_at,
//  or status on the schedule row.
// ─────────────────────────────────────────────────────────────
router.post("/:id/trigger", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();

    // Verify ownership — read the full row for data_source info
    const rows = await sql`
      SELECT * FROM scheduled_notifications
      WHERE id = ${req.params.id} AND client_id = ${req.appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    const schedule = rows[0];

    // Call data_source_url (isolated — errors returned to client, not logged as schedule failure)
    let sourceData;
    try {
      sourceData = await callDataSource(schedule);
    } catch (fetchErr) {
      // Insert a manual-trigger log with the error
      await sql`
        INSERT INTO schedule_execution_logs
          (schedule_id, client_id, triggered_by, status, error_message)
        VALUES
          (${schedule.id}, ${schedule.client_id}, 'manual', 'failed',
           ${fetchErr.message})
      `;

      return res.status(502).json({
        error: `Failed to fetch data_source_url: ${fetchErr.message}`,
      });
    }

    // Process and enqueue notifications
    const { total, successCount, failCount } = await processNotifications(
      sourceData.notifications,
      schedule,
    );

    const logStatus =
      failCount === 0 ? "success" : successCount === 0 ? "failed" : "partial";

    // Insert execution log (triggered_by = 'manual')
    await sql`
      INSERT INTO schedule_execution_logs
        (schedule_id, client_id, triggered_by, status,
         total_recipients, success_count, fail_count)
      VALUES
        (${schedule.id}, ${schedule.client_id}, 'manual', ${logStatus},
         ${total}, ${successCount}, ${failCount})
    `;

    console.log(
      `[schedules] Manual trigger for ${schedule.id}: ${successCount}/${total} sent`,
    );

    return res.json({
      success: true,
      data: {
        total_recipients: total,
        success_count: successCount,
        fail_count: failCount,
        status: logStatus,
      },
    });
  } catch (err) {
    console.error("[schedules] POST trigger error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /schedules/:id/logs — Execution history
// ─────────────────────────────────────────────────────────────
router.get("/:id/logs", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();

    // Verify ownership
    const scheduleRows = await sql`
      SELECT id FROM scheduled_notifications
      WHERE id = ${req.params.id} AND client_id = ${req.appId}
      LIMIT 1
    `;

    if (scheduleRows.length === 0) {
      return res.status(404).json({ error: "Schedule not found" });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const [logsResult, countResult] = await Promise.all([
      sql`
        SELECT id, schedule_id, client_id, triggered_at, triggered_by,
               status, total_recipients, success_count, fail_count, error_message
        FROM schedule_execution_logs
        WHERE schedule_id = ${req.params.id}
        ORDER BY triggered_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT count(*)::int AS total
        FROM schedule_execution_logs
        WHERE schedule_id = ${req.params.id}
      `,
    ]);

    const total = countResult[0]?.total || 0;

    return res.json({
      success: true,
      data: logsResult,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[schedules] GET logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
