const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../../db");
const { enqueueNotification } = require("../../queues/enqueue");
const { renderTemplate } = require("../../utils/template");

const router = Router();

const VALID_CHANNELS = ["push", "email", "sms", "whatsapp", "inapp"];

/**
 * POST /notify
 *
 * Full flow:
 *   1. Validate payload
 *   2. Save notification to DB (status: pending)
 *   3. Fetch + render templates for each channel
 *   4. Enqueue jobs per channel
 *   5. Return immediately with notification_id
 *
 * Body:
 * {
 *   user_id:       "user_123",             — your app's user id
 *   type:          "fee_due",              — template type
 *   channels:      ["push", "email"],      — which channels to fire
 *   variables:     { student_name: "Rahul", amount: "₹5,000" },
 *   user: {                                — delivery addresses
 *     email:               "rahul@gmail.com",
 *     phone:               "+91XXXXXXXXXX",
 *     onesignal_player_id: "abc-123"
 *   },
 *   action_url:    "https://tutrsy.com/fees",
 *   data:          { fee_id: "fee_456" }   — extra payload (optional)
 * }
 */
router.post("/", async (req, res) => {
  try {
    const {
      user_id,
      type,
      channels,
      variables,
      user,
      action_url,
      data,
      entity_id,
    } = req.body;
    const appId = req.appId;

    // ─── 1. Validate ───
    if (
      !user_id ||
      !type ||
      !channels ||
      !Array.isArray(channels) ||
      channels.length === 0
    ) {
      return res.status(400).json({
        error: "Required fields: user_id, type, channels (non-empty array)",
      });
    }

    const invalidChannels = channels.filter((c) => !VALID_CHANNELS.includes(c));
    if (invalidChannels.length > 0) {
      return res.status(400).json({
        error: `Invalid channels: ${invalidChannels.join(", ")}. Allowed: ${VALID_CHANNELS.join(", ")}`,
      });
    }

    // If whatsapp requested but entity_id missing — warn and drop whatsapp
    let effectiveChannels = [...channels];
    if (channels.includes("whatsapp") && !entity_id) {
      console.warn(
        `[notify] ⚠ WhatsApp requested but entity_id missing — skipping whatsapp for user ${user_id}`,
      );
      effectiveChannels = effectiveChannels.filter((c) => c !== "whatsapp");
      if (effectiveChannels.length === 0) {
        return res.status(400).json({
          error: "entity_id is required when the only channel is whatsapp",
        });
      }
    }

    if (!user || typeof user !== "object") {
      return res
        .status(400)
        .json({ error: "user object is required with delivery addresses" });
    }

    const sql = getDb();

    // ─── 2. Fetch templates for each channel ───
    const templates = await sql`
      SELECT channel, title, body, cta_text
      FROM templates
      WHERE app_id = ${appId}
        AND type = ${type}
        AND channel = ANY(${effectiveChannels})
        AND is_active = true
    `;

    // Build a map: channel → rendered template
    const templateMap = {};
    for (const tpl of templates) {
      templateMap[tpl.channel] = {
        title: renderTemplate(tpl.title, variables),
        body: renderTemplate(tpl.body, variables),
        ctaText: renderTemplate(tpl.cta_text, variables),
      };
    }

    // For channels without a template, build a fallback from variables or type
    const resolvedChannels = [];
    for (const ch of effectiveChannels) {
      if (!templateMap[ch]) {
        // Use a generic template
        templateMap[ch] = {
          title: variables?.title || type.replace(/_/g, " "),
          body:
            variables?.body || variables?.message || `Notification: ${type}`,
          ctaText: variables?.cta_text || null,
        };
      }
      resolvedChannels.push(ch);
    }

    // ─── 3. Save notification to DB ───
    // Use the first available template for the master record
    const primaryTemplate = templateMap[effectiveChannels[0]];
    const notificationId = uuidv4();

    await sql`
      INSERT INTO notifications
        (id, app_id, external_user_id, type, title, message, data, action_url, status)
      VALUES
        (${notificationId}, ${appId}, ${user_id}, ${type},
         ${primaryTemplate.title}, ${primaryTemplate.body},
         ${JSON.stringify(data || {})}, ${action_url || null}, 'pending')
    `;

    // ─── 4. Enqueue jobs per channel ───
    const enqueued = await enqueueNotification({
      notificationId,
      appId,
      externalUserId: user_id,
      type,
      template: primaryTemplate,
      user: { ...user, external_user_id: user_id },
      actionUrl: action_url,
      data,
      channels: resolvedChannels,
      entityId: entity_id,
    });

    // ─── 5. Return immediately ───
    return res.status(202).json({
      success: true,
      notification_id: notificationId,
      channels_enqueued: enqueued,
    });
  } catch (err) {
    console.error("[notify] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
