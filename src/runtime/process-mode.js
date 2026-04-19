const { WORKER_CHANNELS } = require("../workers/channels");
const { normalizeWorkerChannel } = require("../utils/channel");

const VALID_MODES = new Set(["all", "api", "worker"]);

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function normalizeMode(raw) {
  const mode = String(raw || "all")
    .trim()
    .toLowerCase();
  if (!VALID_MODES.has(mode)) {
    throw new Error(
      `[runtime] Invalid PROCESS_MODE: "${raw}". Allowed: all, api, worker`,
    );
  }
  return mode;
}

function parseChannels(raw) {
  if (!raw) return [...WORKER_CHANNELS];

  const requested = [...new Set(raw.split(",").map((ch) => ch.trim()))].filter(
    Boolean,
  );

  const channels = [];
  const invalid = [];
  const seen = new Set();

  for (const channel of requested) {
    const normalizedChannel = normalizeWorkerChannel(channel);

    if (!normalizedChannel || !WORKER_CHANNELS.includes(normalizedChannel)) {
      invalid.push(channel);
      continue;
    }

    if (seen.has(normalizedChannel)) {
      continue;
    }

    seen.add(normalizedChannel);
    channels.push(normalizedChannel);
  }

  if (invalid.length > 0) {
    throw new Error(
      `[runtime] Invalid WORKER_CHANNELS: ${invalid.join(", ")}. Allowed: ${WORKER_CHANNELS.join(", ")} (in_app alias is accepted for inapp)`,
    );
  }

  return channels;
}

function getProcessModeConfig() {
  const mode = normalizeMode(readArg("mode") || process.env.PROCESS_MODE);
  const channelsRaw = readArg("channels") || process.env.WORKER_CHANNELS;
  const workerChannels = mode === "api" ? [] : parseChannels(channelsRaw);

  return {
    mode,
    workerChannels,
    runApi: mode === "all" || mode === "api",
    runWorkers: mode === "all" || mode === "worker",
    runMigrations: mode === "all" || mode === "api",
  };
}

module.exports = { getProcessModeConfig };
