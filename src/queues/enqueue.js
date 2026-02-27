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
 * @param {object} opts.template        — { title, body, ctaText } (already rendered)
 * @param {object} opts.user            — { email, phone, onesignal_player_id, ... }
 * @param {string} [opts.actionUrl]
 * @param {object} [opts.data]          — arbitrary extra data
 * @param {string[]} opts.channels      — ["push","email","whatsapp", ...]
 */
async function enqueueNotification(opts) {
  const {
    notificationId,
    appId,
    externalUserId,
    type,
    template,
    user,
    actionUrl,
    data,
    channels,
  } = opts;

  const jobPayload = {
    notificationId,
    appId,
    externalUserId,
    type,
    title: template.title,
    body: template.body,
    ctaText: template.ctaText,
    user,
    actionUrl,
    data,
  };

  const enqueued = [];

  for (const channel of channels) {
    const queue = getQueue(channel);

    await queue.add(
      `${type}:${channel}`, // job name (for dashboard / debugging)
      { ...jobPayload, channel }, // job data
      {
        jobId: `${notificationId}:${channel}`, // dedupe key
      },
    );

    enqueued.push(channel);
  }

  console.log(`[enqueue] ${notificationId} → [${enqueued.join(", ")}]`);
  return enqueued;
}

module.exports = { enqueueNotification };
