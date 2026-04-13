function parseBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;

  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;

  throw new Error(`[config] Invalid boolean for ${name}: "${raw}"`);
}

function parseNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const num = Number.parseInt(raw, 10);

  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`[config] Invalid number for ${name}: "${raw}"`);
  }

  return num;
}

function parseMode() {
  const mode = String(process.env.REDIS_MODE || "single")
    .trim()
    .toLowerCase();
  if (!["single", "sentinel", "cluster"].includes(mode)) {
    throw new Error(
      `[config] Invalid REDIS_MODE: "${mode}". Allowed: single, sentinel, cluster`,
    );
  }
  return mode;
}

function parseNodeList(name) {
  const raw = process.env[name] || "";
  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.map((item) => {
    const [host, portRaw] = item.split(":");
    const port = Number.parseInt(portRaw, 10);
    if (!host || !Number.isInteger(port) || port <= 0) {
      throw new Error(
        `[config] Invalid node in ${name}: "${item}". Expected host:port`,
      );
    }
    return { host, port };
  });
}

function buildCommonOptions() {
  return {
    db: parseNumber("REDIS_DB", 0),
    connectTimeout: parseNumber("REDIS_CONNECT_TIMEOUT_MS", 10000),
    lazyConnect: parseBoolean("REDIS_LAZY_CONNECT", false),
    tlsEnabled: parseBoolean("REDIS_TLS_ENABLED", false),
    tlsRejectUnauthorized: parseBoolean("REDIS_TLS_REJECT_UNAUTHORIZED", true),
    username: process.env.REDIS_USERNAME || "",
    password: process.env.REDIS_PASSWORD || "",
  };
}

function buildSingleConfig(common) {
  return {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    ...common,
  };
}

function buildSentinelConfig(common) {
  const sentinels = parseNodeList("REDIS_SENTINELS");
  const name = process.env.REDIS_SENTINEL_NAME || "";

  if (sentinels.length === 0) {
    throw new Error(
      "[config] REDIS_SENTINELS is required for REDIS_MODE=sentinel",
    );
  }
  if (!name) {
    throw new Error(
      "[config] REDIS_SENTINEL_NAME is required for REDIS_MODE=sentinel",
    );
  }

  return {
    sentinels,
    name,
    sentinelUsername: process.env.REDIS_SENTINEL_USERNAME || "",
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || "",
    ...common,
  };
}

function buildClusterConfig(common) {
  const nodes = parseNodeList("REDIS_CLUSTER_NODES");

  if (nodes.length === 0) {
    throw new Error(
      "[config] REDIS_CLUSTER_NODES is required for REDIS_MODE=cluster",
    );
  }

  return {
    nodes,
    scaleReads: process.env.REDIS_CLUSTER_SCALE_READS || "master",
    maxRedirections: parseNumber("REDIS_CLUSTER_MAX_REDIRECTIONS", 16),
    ...common,
  };
}

function buildRedisConfig() {
  const mode = parseMode();
  const common = buildCommonOptions();

  if (mode === "single") return { mode, single: buildSingleConfig(common) };
  if (mode === "sentinel") {
    return { mode, sentinel: buildSentinelConfig(common) };
  }
  return { mode, cluster: buildClusterConfig(common) };
}

module.exports = { buildRedisConfig };
