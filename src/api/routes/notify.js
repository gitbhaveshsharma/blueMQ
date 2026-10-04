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
  summarizeWhatsAppVariables,
  summarizeWhatsAppTemplate,
} = require("../../utils/whatsapp-template");
const { resolveTemplateAlias } = require("../../utils/template-alias");
const {
  appHasQuotas,
  reserveForChannels,
  guardEntityParent,
} = require("../../utils/quota");

const router = Router();

// ─── Template helpers ────────────────────────────────────────────────────────

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
      if (bestScore === 2) break;
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
    const language =
      variables?.language || variables?.whatsapp_language || null;
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
      console.info(
        `[notify] WhatsApp prepared ${JSON.stringify({
          app_id: appId,
          type,
          entity_id: entityId || null,
          parent_entity_id: parentEntityId || null,
          ...summarizeWhatsAppVariables(variables),
          ...summarizeWhatsAppTemplate(templateMap[channel]),
        })}`,
      );
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

// ─── Idempotency helpers ──────────────────────────────────────────────────────

/**
 * Sanitize an idempotency key supplied by the caller.
 * Returns null if blank/missing so legacy callers are unaffected.
 */
function sanitizeIdempotencyKey(value) {
  if (!value) return null;
  const key = String(value).trim();
  return key.length > 0 && key.length <= 255 ? key : null;
}

/**
 * Qualify an idempotency key with class/session/attendance identifiers if present in data.
 * This guarantees that if a client uses a generic key (e.g. `attendance_student123`),
 * different classes or sessions for the same student on the same day never collide.
 */
function qualifyIdempotencyKey(key, data) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  // Extract class, session, batch, or attendance event identifiers
  const eventRef =
    data?.attendance_id ||
    data?.attendanceId ||
    data?.class_id ||
    data?.classId ||
    data?.session_id ||
    data?.sessionId ||
    data?.batch_id ||
    data?.batchId ||
    data?.subject;

  if (eventRef !== undefined && eventRef !== null) {
    const eventStr = String(eventRef).trim();
    // If the caller's key does not already distinguish this class/event, qualify it
    if (eventStr && !trimmed.toLowerCase().includes(eventStr.toLowerCase())) {
      const qualified = `${trimmed}:${eventStr}`;
      return qualified.length <= 255 ? qualified : trimmed.slice(0, 255);
    }
  }

  return trimmed.length <= 255 ? trimmed : trimmed.slice(0, 255);
}

/**
 * Look up an existing notification by (app_id, entity_id, idempotency_key).
 * Scoped per tenant (coaching center) and within an idempotency TTL window (default 24 hours).
 * Returns the row if found, otherwise null.
 */
async function findByIdempotencyKey(
  sql,
  appId,
  entityId,
  idempotencyKey,
  ttlSeconds = 86400,
) {
  if (!idempotencyKey) return null;
  const normalizedEntity = normalizeEntityId(entityId);
  const rows = await sql`
    SELECT id, status, created_at
    FROM notifications
    WHERE app_id = ${appId}
      AND COALESCE(entity_id, '') = ${normalizedEntity}
      AND idempotency_key = ${idempotencyKey}
      AND created_at >= NOW() - (${ttlSeconds} || ' seconds')::interval
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Check for an accidental burst duplicate (e.g. rapid double-click or network retry
 * within a short debounce window of 10s) when caller does NOT provide an idempotency_key.
 *
 * Scoped strictly to:
 *   (app_id, entity_id, external_user_id, type, exact data payload, rendered message).
 *
 * This ensures:
 * - Different classes on the same day after hours -> NOT blocked (window is only 10s).
 * - Different classes at the same time -> NOT blocked (data / class_id or message is different).
 * - Different coaching centers -> NOT blocked (entity_id is different).
 * - Rapid duplicate submissions within seconds for the EXACT same class -> Deduplicated!
 */
async function findRecentBurstDuplicate(
  sql,
  {
    appId,
    entityId,
    userId,
    type,
    dataPayload,
    primaryBody,
    burstWindowSeconds = 10,
  },
) {
  const normalizedEntity = normalizeEntityId(entityId);
  const dataJson = JSON.stringify(dataPayload || {});
  const rows = await sql`
    SELECT id, status, created_at
    FROM notifications
    WHERE app_id = ${appId}
      AND COALESCE(entity_id, '') = ${normalizedEntity}
      AND external_user_id = ${userId}
      AND type = ${type}
      AND created_at >= NOW() - (${burstWindowSeconds} || ' seconds')::interval
      AND COALESCE(data::text, '{}') = ${dataJson}
      AND COALESCE(message, '') = ${primaryBody || ""}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /notify
 *
 * Full flow:
 *   1. Validate payload
 *   2. Idempotency check:
 *      - If caller passes `idempotency_key`, look up existing notification by
 *        (app_id, entity_id, idempotency_key) within the 24-hour window.
 *        Collapses duplicates without re-enqueueing.
 *   3. Fetch + render templates for each channel
 *   4. Automatic burst deduplication (if no `idempotency_key` is supplied):
 *      - Checks if an identical notification was sent within the last 10s for the
 *        same (app_id, entity_id, user_id, type, data, message).
 *        Prevents rapid double-clicks while never blocking different classes, hours, or coaching centers.
 *   5. Save notification to DB (status: pending, with entity_id stored)
 *   6. Enqueue jobs per channel
 *   7. Return immediately with notification_id
 *
 * Body:
 * {
 *   user_id:          "user_123",
 *   type:             "attendance_marked",
 *   channels:         ["push", "inapp"],
 *   entity_id:        "coaching_center_456",        ← tenant / coaching center
 *   variables:        { student_name: "Rahul", class_name: "10th Maths" },
 *   data:             { class_id: "math_10", attendance_id: "att_789" },
 *   user: {
 *     email:               "rahul@gmail.com",
 *     phone:               "+91XXXXXXXXXX",
 *     fcm_token:           "fcm-device-token"
 *   },
 *   action_url:       "https://tutrsy.com/attendance",
 *   idempotency_key:  "att_789"                     ← optional; scoped per tenant + class
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
      idempotency_key,
    } = req.body;

    const appId = req.appId;
    const resolvedEntityId = normalizeEntityId(entity_id);
    const resolvedParentEntityId = normalizeEntityId(parent_entity_id);
    const rawIdempotencyKey = sanitizeIdempotencyKey(idempotency_key);
    const resolvedIdempotencyKey = rawIdempotencyKey
      ? qualifyIdempotencyKey(rawIdempotencyKey, data)
      : null;

    // ─── 1. Validate ───────────────────────────────────────────────────────
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

    // ─── 1b. Entity-parent guard ──────────────────────────────────────────
    // If both entity_id and parent_entity_id are provided, verify the mapping
    // is consistent with the first time this pair was seen for this app.
    if (resolvedEntityId && resolvedParentEntityId) {
      const guardResult = await guardEntityParent(
        sql,
        appId,
        resolvedEntityId,
        resolvedParentEntityId,
      );
      if (guardResult.conflict) {
        return res.status(409).json({
          error:
            `entity_id "${resolvedEntityId}" was previously registered under ` +
            `parent_entity_id "${guardResult.storedParent}". ` +
            `Cannot change parent to "${resolvedParentEntityId}" via the notify path.`,
        });
      }
    }

    // ─── 1c. Quota: require entity_id if app has quotas configured ────────
    // Cached for 60 s; does not add per-request latency in steady state.
    const quotaOwnerId = resolvedParentEntityId || resolvedEntityId || null;
    if (!quotaOwnerId) {
      const hasQuotas = await appHasQuotas(sql, appId);
      if (hasQuotas) {
        return res.status(400).json({
          error:
            "entity_id (or parent_entity_id) is required for this app because quota profiles are configured.",
        });
      }
    }

    // ─── 2. Idempotency check ──────────────────────────────────────────────
    if (resolvedIdempotencyKey) {
      const existing = await findByIdempotencyKey(
        sql,
        appId,
        resolvedEntityId,
        resolvedIdempotencyKey,
      );
      if (existing) {
        return res.status(202).json({
          success: true,
          notification_id: existing.id,
          channels_enqueued: [],
          deduplicated: true,
        });
      }
    }

    // ─── 3. Prepare templates ──────────────────────────────────────────────
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

    const missingWhatsAppVariables =
      templateMap.whatsapp?.missingVariables || [];
    if (missingWhatsAppVariables.length > 0) {
      return res.status(400).json({
        error: "Missing WhatsApp template variables",
        template: templateMap.whatsapp.templateName,
        language: templateMap.whatsapp.language,
        missing_variables: missingWhatsAppVariables,
      });
    }

    // ─── 3b. Automatic burst deduplication (when caller omitted key) ───────
    if (!resolvedIdempotencyKey) {
      const primaryCandidate = templateMap[effectiveChannels[0]];
      const burstDuplicate = await findRecentBurstDuplicate(sql, {
        appId,
        entityId: resolvedEntityId,
        userId: user_id,
        type,
        dataPayload: data,
        primaryBody: primaryCandidate?.body,
        burstWindowSeconds: 10,
      });
      if (burstDuplicate) {
        return res.status(202).json({
          success: true,
          notification_id: burstDuplicate.id,
          channels_enqueued: [],
          deduplicated: true,
        });
      }
    }

    // ─── 3c. Quota reserve ────────────────────────────────────────────────
    // Reserve one unit per channel. Channels that exceed the limit are
    // removed from effectiveChannels (partial acceptance). The quota_reservations
    // row is inserted atomically alongside the quota_usage update.
    //
    // If the app has no quotas configured (quotaOwnerId is null OR no limits
    // exist for this owner+channel) the reservation is a no-op and every
    // channel passes through unchanged.
    const notificationId = uuidv4();
    let quotaChannelResults = new Map();
    let quotaBlockedChannels = [];

    if (quotaOwnerId) {
      // Map each accepted channel → 1 unit
      const channelUnits = new Map(resolvedChannels.map((ch) => [ch, 1]));
      try {
        const reserveResult = await reserveForChannels(sql, {
          appId,
          ownerId: quotaOwnerId,
          entityId: resolvedEntityId,
          notificationId,
          channelUnits,
        });
        quotaChannelResults = reserveResult.channelResults;

        // Split channels into accepted and blocked
        const blockedSet = new Set(
          [...quotaChannelResults.entries()]
            .filter(([, r]) => r.blocked)
            .map(([ch]) => ch),
        );
        quotaBlockedChannels = resolvedChannels.filter((ch) =>
          blockedSet.has(ch),
        );
        effectiveChannels = resolvedChannels.filter(
          (ch) => !blockedSet.has(ch),
        );

        if (effectiveChannels.length === 0) {
          // All channels quota-blocked
          return res.status(429).json({
            success: false,
            error: "All requested channels are quota-limited for this period.",
            blocked_quota: quotaBlockedChannels.map((ch) => ({
              channel: ch,
              ...quotaChannelResults.get(ch),
            })),
          });
        }
      } catch (reserveErr) {
        console.error("[notify] Quota reserve error:", reserveErr.message);
        // Non-fatal: proceed without quota enforcement on transient errors
      }
    }

    // ─── 4. Save notification to DB ───────────────────────────────────────
    const primaryTemplate = templateMap[effectiveChannels[0]];
    const primaryActionUrl = primaryTemplate?.actionUrl || action_url || null;
    // Store the accepted internal channel list for notification.final detection
    const expectedInternalChannels = effectiveChannels.map(
      (ch) => toInternalChannel(ch) || ch,
    );

    try {
      await sql`
        INSERT INTO notifications
          (id, app_id, entity_id, parent_entity_id, external_user_id, type,
           title, message, data, action_url, status, idempotency_key, expected_channels)
        VALUES
          (${notificationId}, ${appId}, ${resolvedEntityId || null},
           ${resolvedParentEntityId || null}, ${user_id}, ${type},
           ${primaryTemplate.title}, ${primaryTemplate.body},
           ${JSON.stringify(data || {})}, ${primaryActionUrl}, 'pending',
           ${resolvedIdempotencyKey}, ${expectedInternalChannels})
      `;
    } catch (insertErr) {
      // Unique constraint violation on idempotency_key: a concurrent request won.
      if (insertErr.code === "23505" && resolvedIdempotencyKey) {
        const existing = await findByIdempotencyKey(
          sql,
          appId,
          resolvedEntityId,
          resolvedIdempotencyKey,
        );
        if (existing) {
          // Release quota reservation created for this (now unused) notificationId
          // The reservation was for a UUID that will never be enqueued; release it.
          // (best-effort; stale cleanup will also catch this)
          try {
            await sql`
              UPDATE quota_reservations SET status = 'released'
              WHERE notification_id = ${notificationId} AND status = 'reserved'
            `;
          } catch (_) {
            /* ignore */
          }
          return res.status(202).json({
            success: true,
            notification_id: existing.id,
            channels_enqueued: [],
            deduplicated: true,
          });
        }
      }
      throw insertErr;
    }

    // ─── 5. Enqueue jobs per channel ──────────────────────────────────────
    const internalChannels = toInternalChannels(effectiveChannels);
    const templatesByChannel = {};

    for (const channel of effectiveChannels) {
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

    let enqueued;
    try {
      enqueued = await enqueueNotification({
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
    } catch (enqueueErr) {
      // Enqueue failed after the quota reservation was committed.
      // Release all reservations for this notification (best-effort).
      console.error(
        `[notify] Enqueue failed for ${notificationId}, releasing quota reservations:`,
        enqueueErr.message,
      );
      try {
        await sql`
          UPDATE quota_reservations SET status = 'released'
          WHERE notification_id = ${notificationId} AND status = 'reserved'
        `;
        // Also decrement reserved counter in quota_usage for each released channel
        for (const [ch, res] of quotaChannelResults.entries()) {
          if (!res.blocked && quotaOwnerId) {
            await sql`
              UPDATE quota_usage
              SET reserved = GREATEST(0, reserved - 1), updated_at = now()
              WHERE app_id = ${appId} AND owner_id = ${quotaOwnerId}
                AND channel = ${ch} AND period_start = ${res.periodStart}
            `;
          }
        }
      } catch (releaseErr) {
        console.error(
          "[notify] Failed to release quota after enqueue failure:",
          releaseErr.message,
        );
      }
      await sql`
        UPDATE notifications SET status = 'failed' WHERE id = ${notificationId}
      `;
      throw enqueueErr;
    }

    const publicEnqueuedChannels = [
      ...new Set(
        (enqueued || []).map((channel) => toPublicChannel(channel) || channel),
      ),
    ];

    // ─── 6. Return immediately ─────────────────────────────────────────────
    const response = {
      success: true,
      notification_id: notificationId,
      channels_enqueued: publicEnqueuedChannels,
    };

    // Additive: include quota context when relevant
    if (quotaBlockedChannels.length > 0) {
      response.blocked_quota = quotaBlockedChannels.map((ch) => ({
        channel: ch,
        ...quotaChannelResults.get(ch),
      }));
    }

    return res.status(202).json(response);
  } catch (err) {
    console.error("[notify] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

router.post("/", notifyHandler);

module.exports = router;
module.exports.notifyHandler = notifyHandler;
