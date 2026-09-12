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
  toInternalChannel,
  toPublicChannel,
} = require("../../utils/channel");
const config = require("../../config");
const { getAppProvider } = require("../../providers/per-app-factory");
const {
  findCachedSendableTemplate,
  buildWhatsAppSendTemplate,
} = require("../../utils/whatsapp-template");
const { resolveTemplateAlias } = require("../../utils/template-alias");

const router = Router();

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

async function prepareTemplates({
  appId,
  channels,
  entityId,
  parentEntityId,
  type,
  variables,
}) {
  const sql = getDb();
  const aliasEntries = await Promise.all(
    channels.map(async (channel) => {
      const alias = await resolveTemplateAlias({
        appId,
        channel,
        entityId,
        parentEntityId,
        notificationType: type,
      });
      return [channel, alias.templateName];
    }),
  );
  const resolvedTypeByChannel = Object.fromEntries(aliasEntries);
  const dbChannels = channels.filter((channel) => channel !== "whatsapp");
  const templateCandidates = [
    ...new Set(
      dbChannels.flatMap((channel) => getTemplateChannelCandidates(channel)),
    ),
  ];

  let templates = [];
  if (templateCandidates.length > 0) {
    const resolvedDbTypes = [
      ...new Set(dbChannels.map((channel) => resolvedTypeByChannel[channel])),
    ];
    templates = await sql`
      SELECT type, channel, title, body, body_format, cta_text, cta_url,
             condition_key, condition_value, variant_key
      FROM templates
      WHERE app_id = ${appId}
        AND type = ANY(${resolvedDbTypes})
        AND channel = ANY(${templateCandidates})
        AND is_active = true
      ORDER BY channel ASC, updated_at DESC
    `;
  }

  const templateRowsByChannel = {};
  for (const template of templates) {
    const channel = normalizePublicChannel(template.channel);
    if (!channel || template.type !== resolvedTypeByChannel[channel]) continue;
    if (!templateRowsByChannel[channel]) templateRowsByChannel[channel] = [];
    templateRowsByChannel[channel].push(template);
  }

  const whatsappTemplateName = resolvedTypeByChannel.whatsapp || type;
  let whatsappCache = null;
  if (channels.includes("whatsapp")) {
    const language = variables?.language || variables?.whatsapp_language || null;
    whatsappCache = await findCachedSendableTemplate({
      appId,
      entityId,
      parentEntityId,
      name: whatsappTemplateName,
      language,
    });
  }

  const templateMap = {};
  for (const channel of channels) {
    if (channel === "whatsapp") {
      templateMap[channel] = buildWhatsAppSendTemplate({
        cacheRow: whatsappCache,
        type: whatsappTemplateName,
        variables,
        fallback: {
          title: variables?.title || type.replace(/_/g, " "),
          body:
            variables?.body || variables?.message || `Notification: ${type}`,
          bodyFormat: "text",
          ctaText: variables?.cta_text || null,
          actionUrl: variables?.cta_url || null,
        },
      });
      continue;
    }

    const selected = pickBestTemplate(
      templateRowsByChannel[channel] || [],
      variables,
    );
    templateMap[channel] = selected
      ? {
          title: renderTemplate(selected.title, variables),
          body: renderTemplate(selected.body, variables),
          bodyFormat: selected.body_format || "text",
          ctaText: renderTemplate(selected.cta_text, variables),
          actionUrl: renderTemplate(selected.cta_url, variables),
        }
      : {
          title: variables?.title || type.replace(/_/g, " "),
          body:
            variables?.body || variables?.message || `Notification: ${type}`,
          bodyFormat: "text",
          ctaText: variables?.cta_text || null,
          actionUrl: variables?.cta_url || null,
        };
  }

  return { templateMap, resolvedChannels: channels };
}

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
 *   channels:      ["push", "email"],      — which channels to fire (push/email/sms/whatsapp/in_app)
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
async function notifyHandler(req, res) {
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

    let whatsappRequiresEntity = false;
    if (normalizedChannels.includes("whatsapp")) {
      try {
        const { providerName } = await getAppProvider(appId, "whatsapp");
        whatsappRequiresEntity = ["meta", "meta-whatsapp"].includes(
          String(providerName || "").toLowerCase(),
        );
      } catch (providerErr) {
        console.warn(
          `[notify] Failed to resolve WhatsApp provider for ${appId}, assuming Meta requirements: ${providerErr.message}`,
        );
        whatsappRequiresEntity = true;
      }
    }

    // If whatsapp requested with Meta provider but entity context is missing,
    // warn and drop WhatsApp from the delivery set.
    let effectiveChannels = [...normalizedChannels];
    if (
      whatsappRequiresEntity &&
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

    // Audience broadcasts pass a request-scoped cache. Templates are prepared
    // once per entity/language combination while the public /notify contract
    // and response stay exactly the same.
    const preparationKey = JSON.stringify({
      appId,
      effectiveChannels,
      resolvedEntityId,
      resolvedParentEntityId,
      type,
      variables,
    });
    let prepared = req.notificationPreparation?.get(preparationKey);
    if (!prepared) {
      prepared = prepareTemplates({
        appId,
        channels: effectiveChannels,
        entityId: resolvedEntityId,
        parentEntityId: resolvedParentEntityId,
        type,
        variables,
      });
      req.notificationPreparation?.set(preparationKey, prepared);
    }
    prepared = await prepared;
    const { templateMap, resolvedChannels } = prepared;

    // ─── 3. Save notification to DB ───
    // Use the first available template for the master record
    const primaryTemplate = templateMap[effectiveChannels[0]];
    const primaryActionUrl = primaryTemplate?.actionUrl || action_url || null;
    const notificationId = uuidv4();

    await sql`
      INSERT INTO notifications
        (id, app_id, external_user_id, type, title, message, data, action_url, status)
      VALUES
        (${notificationId}, ${appId}, ${user_id}, ${type},
         ${primaryTemplate.title}, ${primaryTemplate.body},
         ${JSON.stringify(data || {})}, ${primaryActionUrl}, 'pending')
    `;

    // ─── 4. Enqueue jobs per channel ───
    const internalChannels = toInternalChannels(resolvedChannels);
    const templatesByChannel = {};

    for (const channel of resolvedChannels) {
      const internalChannel = toInternalChannel(channel);
      if (!internalChannel) continue;
      templatesByChannel[internalChannel] = {
        ...templateMap[channel],
        actionUrl: templateMap[channel]?.actionUrl || action_url || null,
        templateName: templateMap[channel]?.templateName || null,
        language: templateMap[channel]?.language || null,
        parameters: templateMap[channel]?.parameters || null,
      };
    }

    const enqueued = await enqueueNotification({
      notificationId,
      appId,
      externalUserId: user_id,
      type,
      templatesByChannel,
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
}

router.post("/", notifyHandler);

module.exports = router;
module.exports.notifyHandler = notifyHandler;
