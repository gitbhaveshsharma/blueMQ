const { WORKER_CHANNELS } = require("./channels");

const WORKER_FACTORIES = {
  push: require("./push.worker"),
  email: require("./email.worker"),
  sms: require("./sms.worker"),
  whatsapp: require("./whatsapp.worker"),
  inapp: require("./inapp.worker"),
};

function normalizeChannels(channels) {
  const requested = channels?.length ? channels : [...WORKER_CHANNELS];
  const unique = [...new Set(requested.map((ch) => String(ch).trim()))].filter(
    Boolean,
  );

  const invalid = unique.filter((ch) => !WORKER_CHANNELS.includes(ch));
  if (invalid.length > 0) {
    throw new Error(
      `[workers] Invalid channel(s): ${invalid.join(", ")}. Allowed: ${WORKER_CHANNELS.join(", ")}`,
    );
  }

  return unique;
}

function startWorkers(channels) {
  const selected = normalizeChannels(channels);
  const workers = selected.map((channel) => WORKER_FACTORIES[channel]());

  console.log(
    `[workers] Started ${workers.length} worker(s): ${selected.join(", ")}`,
  );
  return workers;
}

function startAllWorkers() {
  return startWorkers(WORKER_CHANNELS);
}

module.exports = { startAllWorkers, startWorkers, WORKER_CHANNELS };
