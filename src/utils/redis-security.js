/**
 * Redis Security Utilities
 * 
 * Helper functions for security middleware Redis operations.
 * Optimized for performance and multi-process environments (PM2).
 */

const { getRedisConnection: getRedis } = require('../queues/connection');

// ─── Redis Key Namespaces ──────────────────────────────────────────────────

const REDIS_KEYS = {
  RATE_LIMIT_GLOBAL: (ip, window) => `security:ratelimit:global:${ip}:${window}`,
  RATE_LIMIT_ENDPOINT: (endpoint, identifier, window) => `security:ratelimit:endpoint:${endpoint}:${identifier}:${window}`,
  RATE_LIMIT_APIKEY: (apiKey, window) => `security:ratelimit:apikey:${apiKey}:${window}`,
  
  AUTH_FAILURES: (ip) => `security:auth:failures:${ip}`,
  AUTH_COOLDOWN: (ip) => `security:auth:cooldown:${ip}`,
  AUTH_ATTEMPTS: (ip) => `security:auth:attempts:${ip}`,
  
  BLACKLIST: (ip) => `security:blacklist:${ip}`,
  
  THREAT_SCORE: (ip) => `security:threat:${ip}`,
  THREAT_LOG: (ip) => `security:threat:log:${ip}`,
  
  METRICS: (name) => `security:metrics:${name}`,
};

// ─── Core Operations ───────────────────────────────────────────────────────

/**
 * Atomic increment with TTL
 * Increments a counter and sets TTL if it's the first increment in the window
 * 
 * @param {string} key - Redis key
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {Promise<number>} Current count after increment
 */
async function incrementWithTTL(key, ttlSeconds) {
  const redis = getRedis();
  
  try {
    // Use pipeline for atomic operation
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    
    const results = await pipeline.exec();
    
    if (!results || results.length !== 2) {
      throw new Error('Redis pipeline execution failed');
    }
    
    const [[incrErr, count], [ttlErr, currentTTL]] = results;
    
    if (incrErr) throw incrErr;
    if (ttlErr) throw ttlErr;
    
    // Set TTL only if key is new (TTL is -1) or expired (TTL is -2)
    if (currentTTL === -1 || currentTTL === -2) {
      await redis.expire(key, ttlSeconds);
    }
    
    return count;
  } catch (error) {
    console.error('[redis-security] incrementWithTTL failed:', error.message);
    // Fail-open: return 0 to allow request through on Redis errors
    return 0;
  }
}

/**
 * Get value with fallback
 * 
 * @param {string} key - Redis key
 * @param {*} fallback - Default value if key doesn't exist
 * @returns {Promise<*>}
 */
async function getWithFallback(key, fallback = null) {
  const redis = getRedis();
  
  try {
    const value = await redis.get(key);
    return value !== null ? value : fallback;
  } catch (error) {
    console.error('[redis-security] getWithFallback failed:', error.message);
    return fallback;
  }
}

/**
 * Set value with TTL
 * 
 * @param {string} key - Redis key
 * @param {*} value - Value to set
 * @param {number} ttlSeconds - Time to live in seconds (0 = no expiry)
 * @returns {Promise<boolean>} Success status
 */
async function setWithTTL(key, value, ttlSeconds = 0) {
  const redis = getRedis();
  
  try {
    if (ttlSeconds > 0) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
    return true;
  } catch (error) {
    console.error('[redis-security] setWithTTL failed:', error.message);
    return false;
  }
}

/**
 * Delete key
 * 
 * @param {string} key - Redis key
 * @returns {Promise<boolean>} Success status
 */
async function deleteKey(key) {
  const redis = getRedis();
  
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('[redis-security] deleteKey failed:', error.message);
    return false;
  }
}

/**
 * Add item to list with TTL
 * 
 * @param {string} key - Redis key
 * @param {*} value - Value to add
 * @param {number} ttlSeconds - Time to live in seconds
 * @param {number} maxLength - Maximum list length (trim oldest)
 * @returns {Promise<number>} List length after add
 */
async function addToList(key, value, ttlSeconds, maxLength = 0) {
  const redis = getRedis();
  
  try {
    const pipeline = redis.pipeline();
    pipeline.rpush(key, value);
    
    if (maxLength > 0) {
      pipeline.ltrim(key, -maxLength, -1);
    }
    
    if (ttlSeconds > 0) {
      pipeline.expire(key, ttlSeconds);
    }
    
    const results = await pipeline.exec();
    
    if (!results || results.length === 0) {
      throw new Error('Redis pipeline execution failed');
    }
    
    const [[err, length]] = results;
    if (err) throw err;
    
    return length;
  } catch (error) {
    console.error('[redis-security] addToList failed:', error.message);
    return 0;
  }
}

/**
 * Get list items
 * 
 * @param {string} key - Redis key
 * @param {number} start - Start index (0-based)
 * @param {number} end - End index (-1 = all)
 * @returns {Promise<array>}
 */
async function getList(key, start = 0, end = -1) {
  const redis = getRedis();
  
  try {
    const items = await redis.lrange(key, start, end);
    return items || [];
  } catch (error) {
    console.error('[redis-security] getList failed:', error.message);
    return [];
  }
}

/**
 * Increment metric counter
 * 
 * @param {string} metricName - Metric name
 * @returns {Promise<number>} New counter value
 */
async function incrementMetric(metricName) {
  const key = REDIS_KEYS.METRICS(metricName);
  const redis = getRedis();
  
  try {
    return await redis.incr(key);
  } catch (error) {
    console.error('[redis-security] incrementMetric failed:', error.message);
    return 0;
  }
}

/**
 * Get metric value
 * 
 * @param {string} metricName - Metric name
 * @returns {Promise<number>}
 */
async function getMetric(metricName) {
  const key = REDIS_KEYS.METRICS(metricName);
  return parseInt(await getWithFallback(key, '0'), 10);
}

/**
 * Batch get multiple keys
 * Uses MGET for performance
 * 
 * @param {array} keys - Array of Redis keys
 * @returns {Promise<object>} Map of key → value
 */
async function batchGet(keys) {
  if (!keys || keys.length === 0) return {};
  
  const redis = getRedis();
  
  try {
    const values = await redis.mget(...keys);
    
    const result = {};
    keys.forEach((key, index) => {
      result[key] = values[index];
    });
    
    return result;
  } catch (error) {
    console.error('[redis-security] batchGet failed:', error.message);
    return {};
  }
}

/**
 * Check if key exists
 * 
 * @param {string} key - Redis key
 * @returns {Promise<boolean>}
 */
async function exists(key) {
  const redis = getRedis();
  
  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    console.error('[redis-security] exists failed:', error.message);
    return false;
  }
}

/**
 * Get TTL remaining for key
 * 
 * @param {string} key - Redis key
 * @returns {Promise<number>} Seconds remaining (-1 = no expiry, -2 = doesn't exist)
 */
async function getTTL(key) {
  const redis = getRedis();
  
  try {
    return await redis.ttl(key);
  } catch (error) {
    console.error('[redis-security] getTTL failed:', error.message);
    return -2;
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  REDIS_KEYS,
  incrementWithTTL,
  getWithFallback,
  setWithTTL,
  deleteKey,
  addToList,
  getList,
  incrementMetric,
  getMetric,
  batchGet,
  exists,
  getTTL,
};
