const DEFAULT_CHANNELS = ["push", "email", "sms", "whatsapp", "call", "inapp"];
const { normalizeWorkerChannel } = require("./src/utils/channel");

function parseWorkerChannels(raw) {
  if (!raw) return [...DEFAULT_CHANNELS];

  const channels = [];
  const seen = new Set();

  for (const channel of raw
    .split(",")
    .map((ch) => ch.trim())
    .filter(Boolean)) {
    const normalizedChannel = normalizeWorkerChannel(channel) || channel;

    if (seen.has(normalizedChannel)) {
      continue;
    }

    seen.add(normalizedChannel);
    channels.push(normalizedChannel);
  }

  return channels;
}

function buildBaseConfig(name) {
  return {
    name,
    script: "src/index.js",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    error_file: `./logs/${name}-error.log`,
    out_file: `./logs/${name}-out.log`,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
    kill_timeout: 12000,
    wait_ready: false,
    listen_timeout: 10000,
  };
}

const workerChannels = parseWorkerChannels(process.env.BLUEMQ_WORKER_CHANNELS);

const apiApp = {
  ...buildBaseConfig("bluemq-api"),
  env: {
    NODE_ENV: "production",
    PORT: 3001,
    NODE_OPTIONS: "--dns-result-order=ipv4first",
    PROCESS_MODE: "api",
    // OTel — override in .env to enable. TELEMETRY_ENABLED=false keeps overhead zero.
    OTEL_SERVICE_NAME: "blueMQ-api",
    TELEMETRY_ENABLED: "false",
    DEPLOYMENT_ENV: "production",
  },
  env_development: {
    NODE_ENV: "development",
    PORT: 3001,
    PROCESS_MODE: "api",
    OTEL_SERVICE_NAME: "blueMQ-api",
    TELEMETRY_ENABLED: "false",
    DEPLOYMENT_ENV: "development",
  },
};

const workerApps = workerChannels.map((channel) => ({
  ...buildBaseConfig(`bluemq-worker-${channel}`),
  env: {
    NODE_ENV: "production",
    NODE_OPTIONS: "--dns-result-order=ipv4first",
    PROCESS_MODE: "worker",
    WORKER_CHANNELS: channel,
    // OTel — distinct service name per worker channel (e.g. blueMQ-worker-email)
    OTEL_SERVICE_NAME: `blueMQ-worker-${channel}`,
    TELEMETRY_ENABLED: "false",
    DEPLOYMENT_ENV: "production",
  },
  env_development: {
    NODE_ENV: "development",
    PROCESS_MODE: "worker",
    WORKER_CHANNELS: channel,
    OTEL_SERVICE_NAME: `blueMQ-worker-${channel}`,
    TELEMETRY_ENABLED: "false",
    DEPLOYMENT_ENV: "development",
  },
}));

module.exports = {
  apps: [apiApp, ...workerApps],
};
