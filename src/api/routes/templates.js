const { Router } = require("express");
const { getDb } = require("../../db");
const {
  normalizePublicChannel,
  isValidPublicChannel,
  getTemplateChannelCandidates,
  getAllowedPublicChannels,
} = require("../../utils/channel");

const router = Router();

const ALLOWED_BODY_FORMATS = Object.freeze({
  email: ["text", "html"],
  default: ["text"],
});
const DEFAULT_VARIANT_KEY = "default";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeBodyFormat(value) {
  if (value === undefined || value === null || value === "") {
    return "text";
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized || "text";
}

function getAllowedBodyFormats(channel) {
  return channel === "email"
    ? ALLOWED_BODY_FORMATS.email
    : ALLOWED_BODY_FORMATS.default;
}

function normalizeOptionalText(value, { toLowerCase = false } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return toLowerCase ? normalized.toLowerCase() : normalized;
}

function normalizeConditionPayload({ condition_key, condition_value }) {
  const conditionKey = normalizeOptionalText(condition_key, {
    toLowerCase: true,
  });
  const conditionValue = normalizeOptionalText(condition_value);
  const hasConditionKey = Boolean(conditionKey);
  const hasConditionValue = Boolean(conditionValue);

  if (hasConditionKey !== hasConditionValue) {
    return {
      error:
        "condition_key and condition_value must be provided together, or both left empty",
    };
  }

  return { conditionKey, conditionValue };
}

function buildVariantKey(conditionKey, conditionValue) {
  if (!conditionKey && !conditionValue) {
    return DEFAULT_VARIANT_KEY;
  }
  return `when:${conditionKey}=${String(conditionValue).trim().toLowerCase()}`;
}

function normalizeTemplateRow(row) {
  return {
    ...row,
    channel: normalizePublicChannel(row.channel) || row.channel,
  };
}

/**
 * Parses date-range query params: `from`, `to`, `days`.
 * - `days`  → last N days from now (takes precedence over from/to)
 * - `from`  → ISO date string for lower bound on created_at
 * - `to`    → ISO date string for upper bound on created_at
 *
 * Returns { fromDate: Date|null, toDate: Date|null, error: string|null }
 */
function parseDateRange({ from, to, days }) {
  if (days !== undefined) {
    const n = parseInt(days, 10);
    if (isNaN(n) || n < 1) {
      return {
        fromDate: null,
        toDate: null,
        error: "days must be a positive integer",
      };
    }
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - n);
    fromDate.setHours(0, 0, 0, 0);
    return { fromDate, toDate: new Date(), error: null };
  }

  let fromDate = null;
  let toDate = null;

  if (from) {
    fromDate = new Date(from);
    if (isNaN(fromDate.getTime())) {
      return { fromDate: null, toDate: null, error: "Invalid `from` date" };
    }
  }

  if (to) {
    toDate = new Date(to);
    if (isNaN(toDate.getTime())) {
      return { fromDate: null, toDate: null, error: "Invalid `to` date" };
    }
    // Include the entire `to` day
    toDate.setHours(23, 59, 59, 999);
  }

  if (fromDate && toDate && fromDate > toDate) {
    return {
      fromDate: null,
      toDate: null,
      error: "`from` must be before `to`",
    };
  }

  return { fromDate, toDate, error: null };
}

/**
 * GET /templates
 *
 * List all templates for the authenticated app.
 * Optional query params:
 *   ?type=fee_due
 *   &channel=push
 *   &days=7          → last N days from now
 *   &from=2024-01-01 → lower bound on created_at (ignored when days is set)
 *   &to=2024-01-31   → upper bound on created_at (ignored when days is set)
 *
 * Date filtering uses ($param IS NULL OR created_at <op> $param) so the
 * query is always fully static — no dynamic SQL fragments are injected.
 * This is required because the custom sql wrapper does not support fragment
 * composition (empty sql`` or chained fragments cause syntax errors).
 */
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { type, channel, from, to, days } = req.query;
    const normalizedChannel = channel ? normalizePublicChannel(channel) : null;

    if (channel && !isValidPublicChannel(channel)) {
      return res.status(400).json({
        error: `Invalid channel. Allowed: ${getAllowedPublicChannels().join(", ")}`,
      });
    }

    const {
      fromDate,
      toDate,
      error: dateError,
    } = parseDateRange({ from, to, days });
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    // Always pass scalar values; NULL means "no bound" and the IS NULL check
    // makes the condition a no-op so the query shape never changes.
    const fromParam = fromDate ?? null;
    const toParam = toDate ?? null;

    const sql = getDb();

    let rows;
    if (type && normalizedChannel) {
      const templateChannelCandidates =
        getTemplateChannelCandidates(normalizedChannel);
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND type    = ${type}
          AND channel = ANY(${templateChannelCandidates})
          AND (${fromParam}::timestamptz IS NULL OR created_at >= ${fromParam}::timestamptz)
          AND (${toParam}::timestamptz   IS NULL OR created_at <= ${toParam}::timestamptz)
        ORDER BY created_at DESC, variant_key ASC
      `;
    } else if (type) {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND type = ${type}
          AND (${fromParam}::timestamptz IS NULL OR created_at >= ${fromParam}::timestamptz)
          AND (${toParam}::timestamptz   IS NULL OR created_at <= ${toParam}::timestamptz)
        ORDER BY created_at DESC, variant_key ASC
      `;
    } else if (normalizedChannel) {
      const templateChannelCandidates =
        getTemplateChannelCandidates(normalizedChannel);
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND channel = ANY(${templateChannelCandidates})
          AND (${fromParam}::timestamptz IS NULL OR created_at >= ${fromParam}::timestamptz)
          AND (${toParam}::timestamptz   IS NULL OR created_at <= ${toParam}::timestamptz)
        ORDER BY created_at DESC, variant_key ASC
      `;
    } else {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND (${fromParam}::timestamptz IS NULL OR created_at >= ${fromParam}::timestamptz)
          AND (${toParam}::timestamptz   IS NULL OR created_at <= ${toParam}::timestamptz)
        ORDER BY created_at DESC, variant_key ASC
      `;
    }

    const normalizedRows = rows.map(normalizeTemplateRow);
    return res.json({ success: true, data: normalizedRows });
  } catch (err) {
    console.error("[templates] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /templates/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT *
      FROM templates
      WHERE id = ${id} AND app_id = ${appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    return res.json({ success: true, data: normalizeTemplateRow(rows[0]) });
  } catch (err) {
    console.error("[templates] GET by id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /templates
 *
 * Create a new template. Body:
 * {
 *   type:     "fee_due",
 *   channel:  "push",
 *   title:    "Fee Reminder 💰",
 *   body:     "Hi {{student_name}}, your fee of {{amount}} is due",
 *   body_format: "text",                -- text | html (email only)
 *   cta_text: "View Fee Details"
 * }
 */
router.post("/", async (req, res) => {
  try {
    const appId = req.appId;
    const {
      type,
      channel,
      title,
      body,
      cta_text,
      cta_url,
      body_format,
      condition_key,
      condition_value,
    } = req.body;
    const normalizedType = normalizeOptionalText(type);
    const normalizedChannel = normalizePublicChannel(channel);
    const normalizedBodyFormat = normalizeBodyFormat(body_format);
    const normalizedBody = normalizeOptionalText(body);
    const normalizedTitle = normalizeOptionalText(title);
    const normalizedCtaText = normalizeOptionalText(cta_text);
    const normalizedCtaUrl = normalizeOptionalText(cta_url);
    const normalizedCondition = normalizeConditionPayload({
      condition_key,
      condition_value,
    });

    if (normalizedCondition.error) {
      return res.status(400).json({ error: normalizedCondition.error });
    }
    const { conditionKey, conditionValue } = normalizedCondition;
    const variantKey = buildVariantKey(conditionKey, conditionValue);

    if (!normalizedType || !normalizedChannel || !normalizedBody) {
      return res.status(400).json({ error: "Required: type, channel, body" });
    }

    if (!isValidPublicChannel(channel)) {
      return res.status(400).json({
        error: `Invalid channel. Allowed: ${getAllowedPublicChannels().join(", ")}`,
      });
    }

    const allowedFormats = getAllowedBodyFormats(normalizedChannel);
    if (!allowedFormats.includes(normalizedBodyFormat)) {
      return res.status(400).json({
        error: `Invalid body_format for ${normalizedChannel}. Allowed: ${allowedFormats.join(", ")}`,
      });
    }

    const sql = getDb();

    if (normalizedChannel === "in_app") {
      // Merge any legacy inapp row into canonical in_app for this app/type before upsert.
      await sql`
        UPDATE templates AS canonical
        SET
          title = legacy.title,
          body = legacy.body,
          body_format = legacy.body_format,
          cta_text = legacy.cta_text,
          cta_url = legacy.cta_url,
          condition_key = legacy.condition_key,
          condition_value = legacy.condition_value,
          is_active = legacy.is_active,
          updated_at = legacy.updated_at
        FROM templates AS legacy
        WHERE canonical.app_id = ${appId}
          AND canonical.type = ${normalizedType}
          AND canonical.channel = 'in_app'
          AND canonical.variant_key = ${variantKey}
          AND legacy.app_id = ${appId}
          AND legacy.type = ${normalizedType}
          AND legacy.channel = 'inapp'
          AND COALESCE(legacy.variant_key, ${DEFAULT_VARIANT_KEY}) = ${variantKey}
          AND legacy.updated_at > canonical.updated_at
      `;

      await sql`
        DELETE FROM templates AS legacy
        USING templates AS canonical
        WHERE legacy.app_id = ${appId}
          AND legacy.type = ${normalizedType}
          AND legacy.channel = 'inapp'
          AND COALESCE(legacy.variant_key, ${DEFAULT_VARIANT_KEY}) = ${variantKey}
          AND canonical.app_id = ${appId}
          AND canonical.type = ${normalizedType}
          AND canonical.channel = 'in_app'
          AND canonical.variant_key = ${variantKey}
      `;

      await sql`
        UPDATE templates
        SET channel = 'in_app', updated_at = now()
        WHERE app_id = ${appId}
          AND type = ${normalizedType}
          AND channel = 'inapp'
          AND COALESCE(variant_key, ${DEFAULT_VARIANT_KEY}) = ${variantKey}
      `;
    }

    const result = await sql`
      INSERT INTO templates (
        app_id,
        type,
        channel,
        variant_key,
        condition_key,
        condition_value,
        title,
        body,
        body_format,
        cta_text,
        cta_url
      )
      VALUES (
        ${appId},
        ${normalizedType},
        ${normalizedChannel},
        ${variantKey},
        ${conditionKey},
        ${conditionValue},
        ${normalizedTitle},
        ${normalizedBody},
        ${normalizedBodyFormat},
        ${normalizedCtaText},
        ${normalizedCtaUrl}
      )
      RETURNING *
    `;

    const normalizedRow = normalizeTemplateRow(result[0]);

    return res.status(201).json({ success: true, data: normalizedRow });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error:
          "A template with the same type, channel, and condition rule already exists",
      });
    }
    console.error("[templates] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /templates/:id
 *
 * Update an existing template.
 */
router.put("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const {
      title,
      body,
      cta_text,
      cta_url,
      is_active,
      body_format,
      condition_key,
      condition_value,
    } = req.body;

    const sql = getDb();
    const existingRows = await sql`
      SELECT *
      FROM templates
      WHERE id = ${id} AND app_id = ${appId}
      LIMIT 1
    `;

    if (existingRows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }
    const existingTemplate = existingRows[0];

    let finalBodyFormat = existingTemplate.body_format || "text";
    if (body_format !== undefined) {
      const normalizedBodyFormat = normalizeBodyFormat(body_format);
      const existingChannel =
        normalizePublicChannel(existingTemplate.channel) ||
        existingTemplate.channel;
      const allowedFormats = getAllowedBodyFormats(existingChannel);

      if (!allowedFormats.includes(normalizedBodyFormat)) {
        return res.status(400).json({
          error: `Invalid body_format for ${existingChannel}. Allowed: ${allowedFormats.join(", ")}`,
        });
      }
      finalBodyFormat = normalizedBodyFormat;
    }

    const hasConditionInput =
      hasOwn(req.body, "condition_key") || hasOwn(req.body, "condition_value");

    let finalConditionKey = existingTemplate.condition_key;
    let finalConditionValue = existingTemplate.condition_value;
    if (hasConditionInput) {
      const normalizedCondition = normalizeConditionPayload({
        condition_key,
        condition_value,
      });
      if (normalizedCondition.error) {
        return res.status(400).json({ error: normalizedCondition.error });
      }
      finalConditionKey = normalizedCondition.conditionKey;
      finalConditionValue = normalizedCondition.conditionValue;
    }
    const finalVariantKey = buildVariantKey(
      finalConditionKey,
      finalConditionValue,
    );

    if (hasOwn(req.body, "is_active") && typeof is_active !== "boolean") {
      return res.status(400).json({ error: "is_active must be a boolean" });
    }

    const hasBody = hasOwn(req.body, "body");
    const finalBody = hasBody
      ? normalizeOptionalText(body)
      : existingTemplate.body;
    if (!finalBody) {
      return res.status(400).json({ error: "body cannot be empty" });
    }

    const result = await sql`
      UPDATE templates
      SET
        title = ${
          hasOwn(req.body, "title")
            ? normalizeOptionalText(title)
            : existingTemplate.title
        },
        body = ${finalBody},
        body_format = ${finalBodyFormat},
        cta_text = ${
          hasOwn(req.body, "cta_text")
            ? normalizeOptionalText(cta_text)
            : existingTemplate.cta_text
        },
        cta_url = ${
          hasOwn(req.body, "cta_url")
            ? normalizeOptionalText(cta_url)
            : existingTemplate.cta_url
        },
        condition_key = ${finalConditionKey},
        condition_value = ${finalConditionValue},
        variant_key = ${finalVariantKey},
        is_active = ${
          hasOwn(req.body, "is_active") ? is_active : existingTemplate.is_active
        },
        updated_at = now()
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    const normalizedRow = normalizeTemplateRow(result[0]);

    return res.json({ success: true, data: normalizedRow });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error:
          "A template with the same type, channel, and condition rule already exists",
      });
    }
    console.error("[templates] PUT error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /templates/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;

    const sql = getDb();

    const result = await sql`
      DELETE FROM templates WHERE id = ${id} AND app_id = ${appId} RETURNING id
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[templates] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
