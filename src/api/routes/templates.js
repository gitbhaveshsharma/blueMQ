const { Router } = require("express");
const { getDb } = require("../../db");

const router = Router();

const VALID_CHANNELS = ["push", "email", "sms", "whatsapp", "in_app"];

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
    const sql = getDb();

    let rows;
    if (type && channel) {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId} AND type = ${type} AND channel = ${channel}
        ORDER BY updated_at DESC
      `;
    } else if (type) {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId} AND type = ${type}
        ORDER BY updated_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM templates
        WHERE app_id = ${appId}
        ORDER BY type, channel
      `;
    }

    return res.json({ success: true, data: rows });
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

    if (!type || !channel || !body) {
      return res.status(400).json({ error: "Required: type, channel, body" });
    }

    if (!VALID_CHANNELS.includes(channel)) {
      return res.status(400).json({
        error: `Invalid channel. Allowed: ${VALID_CHANNELS.join(", ")}`,
      });
    }

    const sql = getDb();

    const result = await sql`
      INSERT INTO templates (app_id, type, channel, title, body, cta_text)
      VALUES (${appId}, ${type}, ${channel}, ${title || null}, ${body}, ${cta_text || null})
      ON CONFLICT (app_id, type, channel) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        cta_text = EXCLUDED.cta_text,
        updated_at = now()
      RETURNING *
    `;

    return res.status(201).json({ success: true, data: result[0] });
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

    return res.json({ success: true, data: result[0] });
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
