/**
 * IP Access Control Middleware
 * 
 * Dynamic IP blacklist/whitelist management.
 * First line of defense - blocks IPs before any processing.
 * 
 * PRODUCTION-SAFE: Disabled by default, requires explicit enabling
 */

const securityConfig = require('../../config/security.config');
const { REDIS_KEYS, getWithFallback, setWithTTL, deleteKey, exists, getTTL } = require('../../utils/redis-security');
const { getClientIP, isWhitelisted } = require('./rate-limiting');

// ─── Blacklist Management ──────────────────────────────────────────────────

/**
 * Add IP to blacklist
 * 
 * @param {string} ip - IP address to blacklist
 * @param {number} durationSeconds - Ban duration (0 = permanent)
 * @param {string} reason - Ban reason
 * @returns {Promise<boolean>} Success status
 */
async function blacklistIP(ip, durationSeconds = 0, reason = 'Manual ban') {
  const key = REDIS_KEYS.BLACKLIST(ip);
  
  const banInfo = JSON.stringify({
    ip,
    reason,
    bannedAt: new Date().toISOString(),
    expiresAt: durationSeconds > 0 
      ? new Date(Date.now() + (durationSeconds * 1000)).toISOString() 
      : 'never',
    duration: durationSeconds,
  });
  
  const ttl = durationSeconds > 0 ? durationSeconds : 0;
  const success = await setWithTTL(key, banInfo, ttl);
  
  if (success) {
    console.warn('[security] IP blacklisted:', {
      ip,
      reason,
      duration: durationSeconds > 0 ? `${durationSeconds}s` : 'permanent',
    });
  }
  
  return success;
}

/**
 * Remove IP from blacklist
 * 
 * @param {string} ip - IP address to unban
 * @returns {Promise<boolean>} Success status
 */
async function unblacklistIP(ip) {
  const key = REDIS_KEYS.BLACKLIST(ip);
  const success = await deleteKey(key);
  
  if (success) {
    console.log('[security] IP removed from blacklist:', ip);
  }
  
  return success;
}

/**
 * Check if IP is blacklisted
 * 
 * @param {string} ip - IP address to check
 * @returns {Promise<{isBlacklisted: boolean, info: object|null}>}
 */
async function isBlacklisted(ip) {
  const key = REDIS_KEYS.BLACKLIST(ip);
  const infoStr = await getWithFallback(key, null);
  
  if (!infoStr) {
    return { isBlacklisted: false, info: null };
  }
  
  try {
    const info = JSON.parse(infoStr);
    return { isBlacklisted: true, info };
  } catch (e) {
    // Invalid JSON, treat as blacklisted but with no info
    return { isBlacklisted: true, info: { reason: 'Unknown' } };
  }
}

/**
 * Get all blacklisted IPs
 * Note: This requires scanning Redis keys - use sparingly
 * 
 * @returns {Promise<array>} Array of {ip, info}
 */
async function getBlacklistedIPs() {
  // This is a placeholder - actual implementation would need Redis SCAN
  // For now, return empty array
  // TODO: Implement with Redis SCAN in Phase 3
  return [];
}

/**
 * Get blacklist info for specific IP
 * 
 * @param {string} ip - IP address
 * @returns {Promise<object|null>} Ban info or null
 */
async function getBlacklistInfo(ip) {
  const result = await isBlacklisted(ip);
  return result.isBlacklisted ? result.info : null;
}

// ─── Middleware ────────────────────────────────────────────────────────────

/**
 * IP access control middleware
 * Checks blacklist/whitelist before any other processing
 * 
 * PRODUCTION-SAFE: Can be disabled via feature flag
 * 
 * @returns {Function} Express middleware
 */
function ipAccessControlMiddleware(req, res, next) {
  // Skip if disabled
  if (!securityConfig.enabled.ipBlacklist) {
    return next();
  }
  
  const clientIP = getClientIP(req);
  
  // Whitelist check (bypass blacklist)
  if (isWhitelisted(clientIP)) {
    return next();
  }
  
  // Blacklist check
  isBlacklisted(clientIP).then(result => {
    if (result.isBlacklisted) {
      const info = result.info || {};
      
      console.warn('[security] Blacklisted IP blocked:', {
        ip: clientIP,
        reason: info.reason,
        bannedAt: info.bannedAt,
        expiresAt: info.expiresAt,
        path: req.path,
      });
      
      // Get TTL for retry-after header
      const key = REDIS_KEYS.BLACKLIST(clientIP);
      getTTL(key).then(ttl => {
        if (ttl > 0) {
          res.setHeader('Retry-After', ttl);
        }
        
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Your IP address has been blocked',
          reason: info.reason || 'Security policy violation',
          expiresAt: info.expiresAt !== 'never' ? info.expiresAt : undefined,
        });
      }).catch(() => {
        // If TTL fetch fails, still return 403
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Your IP address has been blocked',
        });
      });
    } else {
      // Not blacklisted, continue
      next();
    }
  }).catch(error => {
    console.error('[security] IP access control error:', error.message);
    // Fail-open: allow request on errors
    next();
  });
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  ipAccessControlMiddleware,
  blacklistIP,
  unblacklistIP,
  isBlacklisted,
  getBlacklistedIPs,
  getBlacklistInfo,
};
