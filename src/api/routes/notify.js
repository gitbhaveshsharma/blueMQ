const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../../db");
const { enqueueNotification } = require("../../queues/enqueue");
const { renderTemplate } = require("../../utils/template");
const { normalizeEntityId } = require("../../utils/whatsapp-session");
const {
  normalizePublicChannel,
  isValidPublicChannel,
  normalizePublicChannels,
  getTemplateChannelCandidates,
  getAllowedPublicChannels,
  toInternalChannels,
  toPublicChannel,
} = require("../../utils/channel");
const config = require("../../config");

const router = Router();

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
 *     onesignal_player_id: "abc-123",
 *     fcm_token:           "fcm-device-token"
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
      parent_entity_id,
    } = req.body;
    const appId = req.appId;
    const resolvedEntityId = normalizeEntityId(entity_id);
    const resolvedParentEntityId = normalizeEntityId(parent_entity_id);

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

    const invalidChannels = channels.filter(
      (channel) => !isValidPublicChannel(channel),
    );
    if (invalidChannels.length > 0) {
      return res.status(400).json({
        error: `Invalid channels: ${invalidChannels.join(", ")}. Allowed: ${getAllowedPublicChannels().join(", ")}`,
      });
    }

    const normalizedChannels = normalizePublicChannels(channels);
    if (normalizedChannels.length === 0) {
      return res.status(400).json({
        error: "Required fields: user_id, type, channels (non-empty array)",
      });
    }

    // If whatsapp requested but neither child nor parent entity is provided,
    // warn and drop WhatsApp from the delivery set.
    let effectiveChannels = [...normalizedChannels];
    if (
      normalizedChannels.includes("whatsapp") &&
      !resolvedEntityId &&
      !resolvedParentEntityId
    ) {
      console.warn(
        `[notify] ⚠ WhatsApp requested but entity_id/parent_entity_id missing — skipping whatsapp for user ${user_id}`,
      );
      effectiveChannels = effectiveChannels.filter((c) => c !== "whatsapp");
      if (effectiveChannels.length === 0) {
        return res.status(400).json({
          error:
            "entity_id or parent_entity_id is required when the only channel is whatsapp",
        });
      }
    }

    if (!user || typeof user !== "object") {
      return res
        .status(400)
        .json({ error: "user object is required with delivery addresses" });
    }

    if (effectiveChannels.includes("push")) {
      const pushProvider = config.providers.primary.push;
      const hasFirebaseToken = Boolean(
        user.fcm_token ||
        user.fcmToken ||
        user.firebase_token ||
        user.firebaseToken ||
        user.push_token ||
        user.pushToken,
      );

      if (pushProvider === "firebase" && !hasFirebaseToken) {
        return res.status(400).json({
          error:
            "Push channel requires user.fcm_token (or user.firebase_token/user.push_token) when Firebase is the active push provider",
        });
      }
    }

    const sql = getDb();

    // ─── 2. Fetch templates for each channel ───
    const templateCandidates = [
      ...new Set(
        effectiveChannels.flatMap((channel) =>
          getTemplateChannelCandidates(channel),
        ),
      ),
    ];

    console.log(
      `[notify] Template lookup — app_id=${appId}, type=${type}, candidates=[${templateCandidates.join(", ")}]`,
    );

    const templates = await sql`
      SELECT channel, title, body, cta_text
      FROM templates
      WHERE app_id = ${appId}
        AND type = ${type}
        AND channel = ANY(${templateCandidates})
        AND is_active = true
      ORDER BY updated_at DESC
    `;

    console.log(
      `[notify] Found ${templates.length} template(s)${templates.length > 0 ? `: [${templates.map((t) => `${t.channel}: "${t.title}"`).join(", ")}]` : ""}`,
    );

    // Build a map: channel → rendered template
    const templateMap = {};
    for (const tpl of templates) {
      const normalizedTemplateChannel = normalizePublicChannel(tpl.channel);
      if (
        !normalizedTemplateChannel ||
        templateMap[normalizedTemplateChannel]
      ) {
        continue;
      }

      templateMap[normalizedTemplateChannel] = {
        title: renderTemplate(tpl.title, variables),
        body: renderTemplate(tpl.body, variables),
        ctaText: renderTemplate(tpl.cta_text, variables),
      };
    }

    // For channels without a template, build a fallback from variables or type
    const resolvedChannels = [];
    for (const ch of effectiveChannels) {
      if (!templateMap[ch]) {
        console.warn(
          `[notify] ⚠ No template found for channel "${ch}" — using fallback`,
        );
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
    const internalChannels = toInternalChannels(resolvedChannels);

    const enqueued = await enqueueNotification({
      notificationId,
      appId,
      externalUserId: user_id,
      type,
      template: primaryTemplate,
      user: { ...user, external_user_id: user_id },
      actionUrl: action_url,
      data,
      channels: internalChannels,
      entityId: resolvedEntityId,
      parentEntityId: resolvedParentEntityId,
    });

    const publicEnqueuedChannels = [
      ...new Set(
        (enqueued || []).map((channel) => toPublicChannel(channel) || channel),
      ),
    ];

    // ─── 5. Return immediately ───
    return res.status(202).json({
      success: true,
      notification_id: notificationId,
      channels_enqueued: publicEnqueuedChannels,
    });
  } catch (err) {
    console.error("[notify] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
