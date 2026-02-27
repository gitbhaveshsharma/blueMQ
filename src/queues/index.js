const { Queue } = require("bullmq");
const config = require("../config");
const { getRedisConnection } = require("./connection");

/** @type {Map<string, Queue>} */
const queues = new Map();

/**
 * Create all BullMQ queues (one per channel).
 * Call once at startup.
 */
function createQueues() {
  const connection = getRedisConnection();

  for (const [channel, queueName] of Object.entries(config.queues)) {
    const workerCfg = config.workers[channel];

    const queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: workerCfg.retries + 1, // attempts = retries + initial
        backoff: workerCfg.backoff,
        removeOnComplete: { count: 1000 }, // keep last 1000 completed jobs
        removeOnFail: { count: 5000 }, // keep last 5000 failed for inspection
      },
    });

    queues.set(channel, queue);
    console.log(
      `[queues] Created queue: ${queueName} (retries=${workerCfg.retries})`,
    );
  }

  return queues;
}

/**
 * Get a queue by channel name.
 * @param {'push'|'email'|'sms'|'whatsapp'|'inapp'} channel
 * @returns {Queue}
 */
function getQueue(channel) {
  const q = queues.get(channel);
  if (!q) throw new Error(`Queue not found for channel: ${channel}`);
  return q;
}

module.exports = { createQueues, getQueue, queues };
