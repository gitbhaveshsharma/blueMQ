const IORedis = require("ioredis");
const config = require("../config");

let connection;

/**
 * Returns a shared IORedis connection for BullMQ queues and workers.
 * BullMQ requires an ioredis instance (not the URL string).
 */
function getRedisConnection() {
  if (!connection) {
    connection = new IORedis(config.redis.url, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
    });

    connection.on("error", (err) => {
      console.error("[redis] Connection error:", err.message);
    });

    connection.on("connect", () => {
      console.log("[redis] Connected");
    });
  }
  return connection;
}

/**
 * Close the shared Redis connection gracefully.
 */
async function closeRedis() {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

module.exports = { getRedisConnection, closeRedis };
