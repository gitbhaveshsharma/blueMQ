/**
 * Brute Force Protection Middleware
 * 
 * Detects and prevents authentication brute force attacks with:
 * - Exponential backoff after repeated failures
 * - Pattern detection (multiple API keys from same IP)
 * - Auto-ban after excessive attempts
 * 
 * PRODUCTION-SAFE: Defaults are permissive to avoid false positives
 */

const securityConfig = require('../../config/security.config');
const { REDIS_KEYS, incrementWithTTL, getWithFallback, setWithTTL, addToList, getList, deleteKey, getTTL } = require('../../utils/redis-security');
const { getClientIP } = require('./rate-limiting');
const { blacklistIP } = require('./ip-access-control');
const { incrementThreatScore } = require('./threat-scoring');

// ─── Failure Tracking ──────────────────────────────────────────────────────

/**
 * Record a failed authentication attempt
 * 
 * @param {string} ip - Client IP address
 * @param {string} apiKey - Attempted API key (optional)
 * @returns {Promise<number>} Total failure count
 */
async function recordFailedAttempt(ip, apiKey = null) {
  const failureKey = REDIS_KEYS.AUTH_FAILURES(ip);
  const attemptsKey = REDIS_KEYS.AUTH_ATTEMPTS(ip);
  const trackingWindow = securityConfig.bruteForce.trackingWindowSeconds;
  
  // Increment failure counter
  const failures = await incrementWithTTL(failureKey, trackingWindow);
  
  // Track attempted API keys for pattern detection
  if (apiKey) {
    await addToList(
      attemptsKey,
      JSON.stringify({ apiKey: apiKey.substring(0, 8), timestamp: Date.now() }),
      trackingWindow,
      100 // Keep last 100 attempts
    );
  }
  
  console.warn('[security] Auth failure recorded:', {
    ip,
    failures,
    apiKeyAttempted: apiKey ? `${apiKey.substring(0, 8)}...` : 'none',
  });
  
  // Increment threat score
  await incrementThreatScore(ip, 'failed_auth', securityConfig.threatScoring.points.failedAuth);
  
  return failures;
}

/**
 * Reset failure count (after successful auth)
 * 
 * @param {string} ip - Client IP address
 */
async function resetFailureCount(ip) {
  const failureKey = REDIS_KEYS.AUTH_FAILURES(ip);
  const attemptsKey = REDIS_KEYS.AUTH_ATTEMPTS(ip);
  const cooldownKey = REDIS_KEYS.AUTH_COOLDOWN(ip);
  
  await deleteKey(failureKey);
  await deleteKey(attemptsKey);
  await deleteKey(cooldownKey);
  
  console.log('[security] Auth failure count reset for:', ip);
}

/**
 * Get current failure count
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<number>}
 */
async function getFailureCount(ip) {
  const failureKey = REDIS_KEYS.AUTH_FAILURES(ip);
  const count = await getWithFallback(failureKey, '0');
  return parseInt(count, 10);
}

// ─── Cooldown Management ───────────────────────────────────────────────────

/**
 * Check if IP is in cooldown period
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<{blocked: boolean, retryAfter: number, reason: string}>}
 */
async function checkCooldown(ip) {
  const cooldownKey = REDIS_KEYS.AUTH_COOLDOWN(ip);
  const ttl = await getTTL(cooldownKey);
  
  if (ttl > 0) {
    return {
      blocked: true,
      retryAfter: ttl,
      reason: 'Too many failed authentication attempts',
    };
  }
  
  return {
    blocked: false,
    retryAfter: 0,
    reason: null,
  };
}

/**
 * Apply cooldown based on failure count
 * Uses exponential backoff from config
 * 
 * @param {string} ip - Client IP address
 * @param {number} failures - Current failure count
 * @returns {Promise<number>} Cooldown duration in seconds (0 = no cooldown)
 */
async function applyCooldown(ip, failures) {
  const thresholds = securityConfig.bruteForce.thresholds;
  const cooldownKey = REDIS_KEYS.AUTH_COOLDOWN(ip);
  
  // Find applicable threshold (use highest threshold that applies)
  let cooldownSeconds = 0;
  
  for (const threshold of thresholds) {
    if (failures >= threshold.failures) {
      cooldownSeconds = threshold.cooldownSeconds;
    }
  }
  
  if (cooldownSeconds > 0) {
    await setWithTTL(cooldownKey, Date.now() + (cooldownSeconds * 1000), cooldownSeconds);
    
    console.warn('[security] Cooldown applied:', {
      ip,
      failures,
      cooldownSeconds,
      expiresAt: new Date(Date.now() + (cooldownSeconds * 1000)).toISOString(),
    });
  }
  
  return cooldownSeconds;
}

// ─── Pattern Detection ─────────────────────────────────────────────────────

/**
 * Detect suspicious patterns (multiple API keys from same IP)
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<{isSuspicious: boolean, uniqueKeys: number}>}
 */
async function detectSuspiciousPattern(ip) {
  const attemptsKey = REDIS_KEYS.AUTH_ATTEMPTS(ip);
  const attempts = await getList(attemptsKey);
  
  if (attempts.length === 0) {
    return { isSuspicious: false, uniqueKeys: 0 };
  }
  
  // Parse attempts and count unique API keys
  const uniqueKeys = new Set();
  const recentWindow = Date.now() - (15 * 60 * 1000); // Last 15 minutes
  
  attempts.forEach(attempt => {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed.timestamp > recentWindow) {
        uniqueKeys.add(parsed.apiKey);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
  
  const uniqueCount = uniqueKeys.size;
  const isSuspicious = uniqueCount > 5; // More than 5 different keys = suspicious
  
  if (isSuspicious) {
    console.warn('[security] Suspicious pattern detected:', {
      ip,
      uniqueKeysAttempted: uniqueCount,
      totalAttempts: attempts.length,
    });
    
    // Increment threat score for pattern
    await incrementThreatScore(ip, 'suspicious_auth_pattern', 10);
  }
  
  return { isSuspicious, uniqueKeys: uniqueCount };
}

// ─── Auto-Ban ──────────────────────────────────────────────────────────────

/**
 * Check if IP should be auto-banned
 * 
 * @param {string} ip - Client IP address
 * @param {number} failures - Current failure count
 */
async function checkAndBan(ip, failures) {
  const maxAttempts = securityConfig.bruteForce.maxAttempts;
  
  if (failures >= maxAttempts) {
    // Auto-ban for 24 hours
    const banDuration = 86400; // 24 hours
    
    await blacklistIP(
      ip,
      banDuration,
      `Auto-banned: ${failures} failed authentication attempts`
    );
    
    console.error('[security] IP auto-banned for excessive auth failures:', {
      ip,
      failures,
      maxAttempts,
      banDuration,
    });
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────

/**
 * Brute force protection middleware
 * Wraps authentication routes to track failures and enforce cooldowns
 * 
 * PRODUCTION-SAFE: Only tracks failures, doesn't block by default
 * 
 * @returns {Function} Express middleware
 */
function bruteForceProtectionMiddleware(req, res, next) {
  // Skip if disabled
  if (!securityConfig.enabled.bruteForceProtection) {
    return next();
  }
  
  const clientIP = getClientIP(req);
  
  // Check cooldown status BEFORE processing request
  checkCooldown(clientIP).then(cooldownStatus => {
    if (cooldownStatus.blocked) {
      console.warn('[security] Request blocked by cooldown:', {
        ip: clientIP,
        retryAfter: cooldownStatus.retryAfter,
      });
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: cooldownStatus.reason,
        retryAfter: cooldownStatus.retryAfter,
      });
    }
    
    // Continue to next middleware (auth handler)
    next();
  }).catch(error => {
    console.error('[security] Brute force protection error:', error.message);
    // Fail-open: allow request on errors
    next();
  });
}

/**
 * Auth failure handler
 * Call this from auth middleware when authentication fails
 * 
 * @param {object} req - Express request object
 * @param {string} apiKey - Failed API key (optional)
 */
async function handleAuthFailure(req, apiKey = null) {
  const clientIP = getClientIP(req);
  
  // Record failure
  const failures = await recordFailedAttempt(clientIP, apiKey);
  
  // Apply cooldown based on failure count
  await applyCooldown(clientIP, failures);
  
  // Detect suspicious patterns
  await detectSuspiciousPattern(clientIP);
  
  // Check for auto-ban
  await checkAndBan(clientIP, failures);
}

/**
 * Auth success handler
 * Call this from auth middleware when authentication succeeds
 * 
 * @param {object} req - Express request object
 */
async function handleAuthSuccess(req) {
  const clientIP = getClientIP(req);
  await resetFailureCount(clientIP);
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  bruteForceProtectionMiddleware,
  handleAuthFailure,
  handleAuthSuccess,
  recordFailedAttempt,
  resetFailureCount,
  getFailureCount,
  checkCooldown,
  detectSuspiciousPattern,
};
