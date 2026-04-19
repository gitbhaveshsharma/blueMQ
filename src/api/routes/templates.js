const { Router } = require("express");
const { getDb } = require("../../db");
const {
  normalizePublicChannel,
  isValidPublicChannel,
  getTemplateChannelCandidates,
  getAllowedPublicChannels,
} = require("../../utils/channel");

const router = Router();

/**
 * GET /templates
 *
 * List all templates for the authenticated app.
 * Optional query params: ?type=fee_due&channel=push
 */
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { type, channel } = req.query;
    const normalizedChannel = channel ? normalizePublicChannel(channel) : null;

    if (channel && !isValidPublicChannel(channel)) {
      return res.status(400).json({
        error: `Invalid channel. Allowed: ${getAllowedPublicChannels().join(", ")}`,
      });
    }

    const sql = getDb();

    let rows;
    if (type && normalizedChannel) {
      const templateChannelCandidates =
        getTemplateChannelCandidates(normalizedChannel);

      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND type = ${type}
          AND channel = ANY(${templateChannelCandidates})
        ORDER BY updated_at DESC
      `;
    } else if (type) {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId} AND type = ${type}
        ORDER BY updated_at DESC
      `;
    } else if (normalizedChannel) {
      const templateChannelCandidates =
        getTemplateChannelCandidates(normalizedChannel);

      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
          AND channel = ANY(${templateChannelCandidates})
        ORDER BY updated_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
        ORDER BY type, channel
      `;
    }

    const normalizedRows = rows.map((row) => ({
      ...row,
      channel: normalizePublicChannel(row.channel) || row.channel,
    }));

    return res.json({ success: true, data: normalizedRows });
  } catch (err) {
    console.error("[templates] GET error:", err);
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
 *   cta_text: "View Fee Details"
 * }
 */
router.post("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { type, channel, title, body, cta_text } = req.body;
    const normalizedChannel = normalizePublicChannel(channel);

    if (!type || !normalizedChannel || !body) {
      return res.status(400).json({ error: "Required: type, channel, body" });
    }

    if (!isValidPublicChannel(channel)) {
      return res.status(400).json({
        error: `Invalid channel. Allowed: ${getAllowedPublicChannels().join(", ")}`,
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
          cta_text = legacy.cta_text,
          is_active = legacy.is_active,
          updated_at = legacy.updated_at
        FROM templates AS legacy
        WHERE canonical.app_id = ${appId}
          AND canonical.type = ${type}
          AND canonical.channel = 'in_app'
          AND legacy.app_id = ${appId}
          AND legacy.type = ${type}
          AND legacy.channel = 'inapp'
          AND legacy.updated_at > canonical.updated_at
      `;

      await sql`
        DELETE FROM templates AS legacy
        USING templates AS canonical
        WHERE legacy.app_id = ${appId}
          AND legacy.type = ${type}
          AND legacy.channel = 'inapp'
          AND canonical.app_id = ${appId}
          AND canonical.type = ${type}
          AND canonical.channel = 'in_app'
      `;

      await sql`
        UPDATE templates
        SET channel = 'in_app', updated_at = now()
        WHERE app_id = ${appId}
          AND type = ${type}
          AND channel = 'inapp'
      `;
    }

    const result = await sql`
      INSERT INTO templates (app_id, type, channel, title, body, cta_text)
      VALUES (${appId}, ${type}, ${normalizedChannel}, ${title || null}, ${body}, ${cta_text || null})
      ON CONFLICT (app_id, type, channel) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        cta_text = EXCLUDED.cta_text,
        updated_at = now()
      RETURNING *
    `;

    const normalizedRow = {
      ...result[0],
      channel: normalizePublicChannel(result[0].channel) || result[0].channel,
    };

    return res.status(201).json({ success: true, data: normalizedRow });
  } catch (err) {
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
    const { title, body, cta_text, is_active } = req.body;

    const sql = getDb();

    const result = await sql`
      UPDATE templates
      SET
        title = COALESCE(${title ?? null}, title),
        body = COALESCE(${body ?? null}, body),
        cta_text = COALESCE(${cta_text ?? null}, cta_text),
        is_active = COALESCE(${is_active ?? null}, is_active),
        updated_at = now()
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    const normalizedRow = {
      ...result[0],
      channel: normalizePublicChannel(result[0].channel) || result[0].channel,
    };

    return res.json({ success: true, data: normalizedRow });
  } catch (err) {
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
