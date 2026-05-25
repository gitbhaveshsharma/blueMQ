const { getQueue } = require("./index");

/**
 * Enqueue notification jobs for the requested channels.
 *
 * Called after the notification row is saved and templates are rendered.
 * Each channel gets its own job in its own queue so they never block
 * each other.
 *
 * @param {object} opts
 * @param {string} opts.notificationId  — UUID already in the DB
 * @param {string} opts.appId
 * @param {string} opts.externalUserId
 * @param {string} opts.type            — template type e.g. "fee_due"
 * @param {object} opts.templatesByChannel — channel -> { title, body, bodyFormat, ctaText, actionUrl }
 * @param {object} opts.user            — { email, phone, onesignal_player_id, ... }
 * @param {string} [opts.actionUrl]
 * @param {object} [opts.data]          — arbitrary extra data
 * @param {string} [opts.parentEntityId]
 * @param {string[]} opts.channels      — ["push","email","whatsapp", ...]
 */
async function enqueueNotification(opts) {
  const {
    notificationId,
    appId,
    externalUserId,
    type,
    templatesByChannel,
    user,
    actionUrl,
    data,
    channels,
    entityId,
    parentEntityId,
  } = opts;

  const normalizedUser = user && typeof user === "object" ? { ...user } : {};
  if (externalUserId && !normalizedUser.external_user_id) {
    normalizedUser.external_user_id = externalUserId;
  }
  if (externalUserId && !normalizedUser.id) {
    normalizedUser.id = externalUserId;
  }

  const defaultTemplate = templatesByChannel?.[channels?.[0]] || {
    title: "",
    body: "",
    bodyFormat: "text",
    ctaText: null,
    actionUrl: null,
  };

  const enqueued = [];

  for (const channel of channels) {
    const queue = getQueue(channel);

    const template = templatesByChannel?.[channel] || defaultTemplate;
    const resolvedActionUrl = template.actionUrl || actionUrl || null;
    const jobPayload = {
      notificationId,
      appId,
      externalUserId,
      type,
      title: template.title,
      body: template.body,
      bodyFormat: template.bodyFormat || "text",
      ctaText: template.ctaText,
      user: normalizedUser,
      actionUrl: resolvedActionUrl,
      data,
      entityId,
      parentEntityId,
    };

    await queue.add(
      `${type}:${channel}`, // job name (for dashboard / debugging)
      { ...jobPayload, channel }, // job data
      {
        jobId: `${notificationId}__${channel}`, // dedupe key (BullMQ custom id cannot contain ":")
      },
    );

    enqueued.push(channel);
  }

  console.log(`[enqueue] ${notificationId} → [${enqueued.join(", ")}]`);
  return enqueued;
}

module.exports = { enqueueNotification };
