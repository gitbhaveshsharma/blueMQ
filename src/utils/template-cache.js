/**
 * Redis caching utilities for WhatsApp template resolution
 * 
 * Provides caching for:
 * - Fallback entities (app-level WhatsApp sessions)
 * - Template aliases (notification_type → template_name mappings)
 * - Sendable templates (full WhatsApp template content)
 * 
 * All cache operations include:
 * - Graceful fallback on Redis failures
 * - Structured logging with timing metrics
 * - Configurable TTLs per cache type
 * - Feature flag control (ENABLE_REDIS_TEMPLATE_CACHE)
 */

const config = require("../config");
const { getRedisConnection } = require("../queues/connection");

/**
 * Get value from Redis cache with error handling.
 * 
 * @param {string} key - Cache key
 * @param {string} context - Context for logging (e.g., "fallback_entity", "template")
 * @returns {Promise<any|null>} - Parsed value or null if not found/error
 */
async function getFromCache(key, context) {
  if (!config.performance.enableRedisTemplateCache) {
    return null;
  }

  const startTime = Date.now();
  
  try {
    const redis = getRedisConnection();
    const value = await redis.get(key);
    const duration = Date.now() - startTime;

    if (value !== null) {
      console.info(
        `[template-cache] ✓ Cache hit context="${context}" key="${key}" duration_ms=${duration}`,
      );
      return JSON.parse(value);
    }

    console.info(
      `[template-cache] ✗ Cache miss context="${context}" key="${key}" duration_ms=${duration}`,
    );
    return null;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[template-cache] Cache read failed context="${context}" key="${key}" duration_ms=${duration} error="${err.message}"`,
    );
    // Graceful fallback: return null, let caller query database
    return null;
  }
}

/**
 * Set value in Redis cache with TTL.
 * 
 * @param {string} key - Cache key
 * @param {any} value - Value to cache (will be JSON.stringified)
 * @param {number} ttl - Time-to-live in seconds
 * @param {string} context - Context for logging
 * @returns {Promise<boolean>} - true if cached successfully, false otherwise
 */
async function setInCache(key, value, ttl, context) {
  if (!config.performance.enableRedisTemplateCache) {
    return false;
  }

  const startTime = Date.now();

  try {
    const redis = getRedisConnection();
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttl, serialized);
    
    const duration = Date.now() - startTime;
    console.info(
      `[template-cache] ✓ Cached context="${context}" key="${key}" ttl=${ttl}s size=${serialized.length} duration_ms=${duration}`,
    );
    return true;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[template-cache] Cache write failed context="${context}" key="${key}" duration_ms=${duration} error="${err.message}"`,
    );
    // Graceful fallback: log error but don't throw
    return false;
  }
}

/**
 * Generate cache key for fallback entity.
 * 
 * @param {string} appId - Application ID (e.g., "tutrsy")
 * @returns {string} - Cache key
 */
function fallbackEntityKey(appId) {
  return `bluemq:fallback_entity:${appId}`;
}

/**
 * Generate cache key for template alias.
 * 
 * @param {string} appId - Application ID
 * @param {string} channel - Channel (whatsapp, email, etc.)
 * @param {string} entityId - Entity ID or "global"
 * @param {string} notificationType - Notification type
 * @returns {string} - Cache key
 */
function templateAliasKey(appId, channel, entityId, notificationType) {
  const entity = entityId || "global";
  return `bluemq:alias:${appId}:${channel}:${entity}:${notificationType}`;
}

/**
 * Generate cache key for sendable template.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @param {string} name - Template name
 * @param {string} language - Language code or "*" for any
 * @returns {string} - Cache key
 */
function templateKey(appId, entityId, name, language) {
  const lang = language || "*";
  return `bluemq:template:${appId}:${entityId}:${name}:${lang}`;
}

/**
 * Cache fallback entity with configured TTL.
 * 
 * @param {string} appId - Application ID
 * @param {string|null} entityId - Fallback entity ID
 * @returns {Promise<boolean>} - true if cached
 */
async function cacheFallbackEntity(appId, entityId) {
  const key = fallbackEntityKey(appId);
  const value = entityId || "";  // Empty string for "no fallback"
  const ttl = config.performance.cacheTtl.fallbackEntity;
  return setInCache(key, value, ttl, "fallback_entity");
}

/**
 * Get cached fallback entity.
 * 
 * @param {string} appId - Application ID
 * @returns {Promise<string|null>} - Entity ID or null if not cached
 */
async function getCachedFallbackEntity(appId) {
  const key = fallbackEntityKey(appId);
  const value = await getFromCache(key, "fallback_entity");
  return value === "" ? null : value;  // Empty string means "no fallback"
}

/**
 * Cache template alias with configured TTL.
 * 
 * @param {string} appId - Application ID
 * @param {string} channel - Channel
 * @param {string} entityId - Entity ID
 * @param {string} notificationType - Notification type
 * @param {Object} aliasResult - Alias resolution result
 * @returns {Promise<boolean>} - true if cached
 */
async function cacheTemplateAlias(appId, channel, entityId, notificationType, aliasResult) {
  const key = templateAliasKey(appId, channel, entityId, notificationType);
  const ttl = config.performance.cacheTtl.templateAlias;
  return setInCache(key, aliasResult, ttl, "template_alias");
}

/**
 * Get cached template alias.
 * 
 * @param {string} appId - Application ID
 * @param {string} channel - Channel
 * @param {string} entityId - Entity ID
 * @param {string} notificationType - Notification type
 * @returns {Promise<Object|null>} - Alias result or null
 */
async function getCachedTemplateAlias(appId, channel, entityId, notificationType) {
  const key = templateAliasKey(appId, channel, entityId, notificationType);
  return getFromCache(key, "template_alias");
}

/**
 * Cache sendable template with configured TTL.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @param {string} name - Template name
 * @param {string} language - Language code
 * @param {Object} template - Template data
 * @returns {Promise<boolean>} - true if cached
 */
async function cacheTemplate(appId, entityId, name, language, template) {
  const key = templateKey(appId, entityId, name, language);
  const ttl = config.performance.cacheTtl.template;
  return setInCache(key, template, ttl, "template");
}

/**
 * Get cached sendable template.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @param {string} name - Template name
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} - Template data or null
 */
async function getCachedTemplate(appId, entityId, name, language) {
  const key = templateKey(appId, entityId, name, language);
  return getFromCache(key, "template");
}

module.exports = {
  // Core cache operations
  getFromCache,
  setInCache,
  
  // Key generators
  fallbackEntityKey,
  templateAliasKey,
  templateKey,
  
  // Fallback entity cache
  cacheFallbackEntity,
  getCachedFallbackEntity,
  
  // Template alias cache
  cacheTemplateAlias,
  getCachedTemplateAlias,
  
  // Template cache
  cacheTemplate,
  getCachedTemplate,
};
