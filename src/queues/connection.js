const IORedis = require("ioredis");
const config = require("../config");

let connection;
let publisher;
let subscriber;

function withCommonOptions(base) {
  return {
    ...base,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function toTlsOptions(enabled, rejectUnauthorized) {
  return enabled ? { tls: { rejectUnauthorized } } : {};
}

function buildSingleConnection() {
  const cfg = config.redis.single;
  const options = withCommonOptions({
    connectTimeout: cfg.connectTimeout,
    db: cfg.db,
    lazyConnect: cfg.lazyConnect,
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    ...toTlsOptions(cfg.tlsEnabled, cfg.tlsRejectUnauthorized),
  });

  return new IORedis(cfg.url, options);
}

function buildSentinelConnection() {
  const cfg = config.redis.sentinel;

  return new IORedis(
    withCommonOptions({
      sentinels: cfg.sentinels,
      name: cfg.name,
      db: cfg.db,
      lazyConnect: cfg.lazyConnect,
      connectTimeout: cfg.connectTimeout,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      sentinelUsername: cfg.sentinelUsername || undefined,
      sentinelPassword: cfg.sentinelPassword || undefined,
      ...toTlsOptions(cfg.tlsEnabled, cfg.tlsRejectUnauthorized),
    }),
  );
}

function buildClusterConnection() {
  const cfg = config.redis.cluster;

  return new IORedis.Cluster(cfg.nodes, {
    scaleReads: cfg.scaleReads,
    maxRedirections: cfg.maxRedirections,
    redisOptions: withCommonOptions({
      db: cfg.db,
      lazyConnect: cfg.lazyConnect,
      connectTimeout: cfg.connectTimeout,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      ...toTlsOptions(cfg.tlsEnabled, cfg.tlsRejectUnauthorized),
    }),
  });
}

function createConnection() {
  const mode = config.redis.mode;
  if (mode === "single") return buildSingleConnection();
  if (mode === "sentinel") return buildSentinelConnection();
  if (mode === "cluster") return buildClusterConnection();

  throw new Error(`[redis] Unsupported mode: ${mode}`);
}

function attachConnectionListeners(client) {
  client.on("error", (err) => {
    console.error(
      `[redis:${config.redis.mode}] Connection error:`,
      err.message,
    );
  });

  client.on("connect", () => {
    console.log(`[redis:${config.redis.mode}] Connected`);
  });

  client.on("ready", () => {
    console.log(`[redis:${config.redis.mode}] Ready`);
  });
}

function createClient() {
  const client = createConnection();
  attachConnectionListeners(client);
  return client;
}

/**
 * Returns a shared IORedis connection for BullMQ queues and workers.
 * BullMQ requires an ioredis instance (not the URL string).
 */
function getRedisConnection() {
  if (!connection) {
    connection = createClient();
  }
  return connection;
}

/**
 * Publisher connection for Redis pub/sub.
 */
function getRedisPublisher() {
  if (!publisher) {
    publisher = createClient();
  }
  return publisher;
}

/**
 * Subscriber connection for Redis pub/sub.
 */
function getRedisSubscriber() {
  if (!subscriber) {
    subscriber = createClient();
  }
  return subscriber;
}

/**
 * Close the shared Redis connection gracefully.
 */
async function closeRedis() {
  if (connection) {
    await connection.quit();
    connection = null;
  }
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
}

module.exports = {
  getRedisConnection,
  getRedisPublisher,
  getRedisSubscriber,
  closeRedis,
};
