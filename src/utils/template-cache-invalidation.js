/**
 * Cache invalidation utilities for WhatsApp template system
 * 
 * Provides selective invalidation of Redis cache entries when:
 * - Templates are synced from Meta
 * - WhatsApp sessions are created/updated/deleted
 * - Template aliases are created/updated/deleted
 */

const config = require("../config");
const { getRedisConnection } = require("../queues/connection");
const { fallbackEntityKey, templateAliasKey, templateKey } = require("./template-cache");

/**
 * Delete key(s) from Redis cache with pattern support.
 * 
 * @param {string|string[]} keyOrPattern - Single key, array of keys, or pattern with wildcards
 * @param {string} context - Context for logging
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateCache(keyOrPattern, context) {
  if (!config.performance.enableRedisTemplateCache) {
    return 0;
  }

  const startTime = Date.now();

  try {
    const redis = getRedisConnection();
    let deletedCount = 0;

    if (Array.isArray(keyOrPattern)) {
      // Batch delete multiple keys
      if (keyOrPattern.length > 0) {
        deletedCount = await redis.del(...keyOrPattern);
      }
    } else if (keyOrPattern.includes("*") || keyOrPattern.includes("?")) {
      // Pattern-based invalidation using SCAN + DEL
      const keys = [];
      let cursor = "0";
      
      do {
        const [nextCursor, batch] = await redis.scan(
          cursor,
          "MATCH",
          keyOrPattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== "0");

      if (keys.length > 0) {
        deletedCount = await redis.del(...keys);
      }
    } else {
      // Single key deletion
      deletedCount = await redis.del(keyOrPattern);
    }

    const duration = Date.now() - startTime;
    
    if (deletedCount > 0) {
      console.info(
        `[template-cache] ✓ Invalidated context="${context}" pattern="${keyOrPattern}" deleted=${deletedCount} duration_ms=${duration}`,
      );
    } else {
      console.info(
        `[template-cache] No keys matched context="${context}" pattern="${keyOrPattern}" duration_ms=${duration}`,
      );
    }

    return deletedCount;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[template-cache] Invalidation failed context="${context}" pattern="${keyOrPattern}" duration_ms=${duration} error="${err.message}"`,
    );
    // Graceful fallback: log error but don't throw
    return 0;
  }
}

/**
 * Invalidate fallback entity cache for an app.
 * Called when a WhatsApp session is marked/unmarked as fallback.
 * 
 * @param {string} appId - Application ID
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateFallbackEntity(appId) {
  const key = fallbackEntityKey(appId);
  return invalidateCache(key, "fallback_entity_changed");
}

/**
 * Invalidate all template caches for an entity.
 * Called when templates are synced from Meta or sessions are deleted.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateEntityTemplates(appId, entityId) {
  const pattern = `bluemq:template:${appId}:${entityId}:*`;
  return invalidateCache(pattern, "entity_templates_synced");
}

/**
 * Invalidate all template alias caches for an entity.
 * Called when template aliases are created/updated/deleted.
 * 
 * @param {string} appId - Application ID
 * @param {string} channel - Channel (whatsapp, email, etc.)
 * @param {string} entityId - Entity ID
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateEntityAliases(appId, channel, entityId) {
  const pattern = `bluemq:alias:${appId}:${channel}:${entityId}:*`;
  return invalidateCache(pattern, "entity_aliases_changed");
}

/**
 * Invalidate specific template alias cache.
 * Called when a specific alias is updated/deleted.
 * 
 * @param {string} appId - Application ID
 * @param {string} channel - Channel
 * @param {string} entityId - Entity ID
 * @param {string} notificationType - Notification type
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateTemplateAlias(appId, channel, entityId, notificationType) {
  const key = templateAliasKey(appId, channel, entityId, notificationType);
  return invalidateCache(key, "template_alias_changed");
}

/**
 * Invalidate specific template cache.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @param {string} name - Template name
 * @param {string} language - Language code or "*" for all languages
 * @returns {Promise<number>} - Number of keys deleted
 */
async function invalidateTemplate(appId, entityId, name, language = "*") {
  const key = templateKey(appId, entityId, name, language);
  return invalidateCache(key, "template_changed");
}

/**
 * Invalidate all caches for an entity (templates + aliases).
 * Nuclear option for complete cache clear on entity configuration changes.
 * 
 * @param {string} appId - Application ID
 * @param {string} entityId - Entity ID
 * @returns {Promise<number>} - Total keys deleted
 */
async function invalidateEntityCache(appId, entityId) {
  const patterns = [
    `bluemq:template:${appId}:${entityId}:*`,
    `bluemq:alias:${appId}:*:${entityId}:*`,
  ];
  
  let totalDeleted = 0;
  for (const pattern of patterns) {
    totalDeleted += await invalidateCache(pattern, "entity_cache_cleared");
  }
  
  return totalDeleted;
}

module.exports = {
  // Core invalidation
  invalidateCache,
  
  // Specific invalidators
  invalidateFallbackEntity,
  invalidateEntityTemplates,
  invalidateEntityAliases,
  invalidateTemplateAlias,
  invalidateTemplate,
  invalidateEntityCache,
};
