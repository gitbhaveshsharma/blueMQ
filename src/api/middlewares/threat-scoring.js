/**
 * Threat Scoring System
 * 
 * Tracks cumulative suspicious behavior per IP.
 * Auto-bans IPs that exceed threat threshold.
 * 
 * PRODUCTION-SAFE: Conservative thresholds, 24h decay
 */

const securityConfig = require('../../config/security.config');
const { REDIS_KEYS, incrementWithTTL, getWithFallback, addToList, getList } = require('../../utils/redis-security');

// ─── Threat Score Management ───────────────────────────────────────────────

/**
 * Increment threat score for IP
 * 
 * @param {string} ip - Client IP address
 * @param {string} reason - Threat reason (e.g., 'path_traversal', 'sql_injection')
 * @param {number} points - Points to add
 * @returns {Promise<number>} New total score
 */
async function incrementThreatScore(ip, reason, points) {
  const scoreKey = REDIS_KEYS.THREAT_SCORE(ip);
  const logKey = REDIS_KEYS.THREAT_LOG(ip);
  const decaySeconds = securityConfig.threatScoring.decayHours * 3600;
  
  // Increment score with TTL (score decays after configured hours)
  const newScore = await incrementWithTTL(scoreKey, decaySeconds);
  
  // Add score increment (not total) to match the actual increment
  const actualIncrement = points;
  const updatedScore = parseInt(await getWithFallback(scoreKey, '0'), 10) + actualIncrement;
  
  // Update the score to correct value
  const redis = require('../queues/connection').getRedis();
  await redis.incrby(scoreKey, actualIncrement - 1); // -1 because incrementWithTTL already added 1
  
  // Log the incident
  const incident = JSON.stringify({
    reason,
    points: actualIncrement,
    timestamp: new Date().toISOString(),
    totalScore: updatedScore,
  });
  
  await addToList(logKey, incident, decaySeconds, 100); // Keep last 100 incidents
  
  console.warn('[security] Threat score incremented:', {
    ip,
    reason,
    points: actualIncrement,
    totalScore: updatedScore,
  });
  
  return updatedScore;
}

/**
 * Get current threat score for IP
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<number>}
 */
async function getThreatScore(ip) {
  const scoreKey = REDIS_KEYS.THREAT_SCORE(ip);
  const score = await getWithFallback(scoreKey, '0');
  return parseInt(score, 10);
}

/**
 * Get threat incident log for IP
 * 
 * @param {string} ip - Client IP address
 * @param {number} limit - Max incidents to return
 * @returns {Promise<array>}
 */
async function getThreatLog(ip, limit = 20) {
  const logKey = REDIS_KEYS.THREAT_LOG(ip);
  const incidents = await getList(logKey, 0, limit - 1);
  
  return incidents.map(incident => {
    try {
      return JSON.parse(incident);
    } catch (e) {
      return { error: 'Invalid incident data' };
    }
  });
}

/**
 * Reset threat score for IP
 * Use with caution - only for false positives
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<boolean>}
 */
async function resetThreatScore(ip) {
  const scoreKey = REDIS_KEYS.THREAT_SCORE(ip);
  const logKey = REDIS_KEYS.THREAT_LOG(ip);
  const { deleteKey } = require('../../utils/redis-security');
  
  await deleteKey(scoreKey);
  await deleteKey(logKey);
  
  console.log('[security] Threat score reset for:', ip);
  return true;
}

// ─── Auto-Ban Logic ────────────────────────────────────────────────────────

/**
 * Check if IP should be auto-banned based on threat score
 * 
 * @param {string} ip - Client IP address
 * @returns {Promise<{shouldBan: boolean, score: number}>}
 */
async function checkAndBanIfHighThreat(ip) {
  const score = await getThreatScore(ip);
  const threshold = securityConfig.threatScoring.threshold;
  const autoBanEnabled = securityConfig.threatScoring.autoBan;
  
  const shouldBan = autoBanEnabled && score >= threshold;
  
  if (shouldBan) {
    // Auto-ban IP for 24 hours
    const { blacklistIP } = require('./ip-access-control');
    const banDuration = 86400; // 24 hours
    
    await blacklistIP(
      ip,
      banDuration,
      `Auto-banned: threat score ${score} exceeds threshold ${threshold}`
    );
    
    console.error('[security] IP auto-banned for high threat score:', {
      ip,
      score,
      threshold,
      banDuration,
    });
  }
  
  return { shouldBan, score };
}

/**
 * Get threat score summary for all tracked IPs
 * Note: This requires scanning Redis keys - use sparingly
 * 
 * @returns {Promise<array>}
 */
async function getThreatScoreSummary() {
  // This is a placeholder - actual implementation would need Redis SCAN
  // For now, return empty array
  // TODO: Implement with Redis SCAN in Phase 3
  return [];
}

// ─── Integration Helpers ───────────────────────────────────────────────────

/**
 * Record threat from request validation
 * Call this from request validation middleware
 * 
 * @param {string} ip - Client IP
 * @param {string} pattern - Pattern that was detected
 */
async function recordValidationThreat(ip, pattern) {
  const points = securityConfig.threatScoring.points;
  let reason = 'unknown';
  let score = 0;
  
  switch (pattern) {
    case 'path_traversal':
      reason = 'path_traversal';
      score = points.pathTraversal;
      break;
    case 'sql_injection':
      reason = 'sql_injection';
      score = points.sqlInjection;
      break;
    case 'exploit_path':
      reason = 'exploit_path';
      score = points.exploitPath;
      break;
    default:
      reason = pattern;
      score = 5; // Default score
  }
  
  await incrementThreatScore(ip, reason, score);
  await checkAndBanIfHighThreat(ip);
}

/**
 * Record threat from rate limiting
 * Call this when rate limit is exceeded
 * 
 * @param {string} ip - Client IP
 */
async function recordRateLimitThreat(ip) {
  const points = securityConfig.threatScoring.points.rateLimitHit;
  await incrementThreatScore(ip, 'rate_limit_exceeded', points);
  // Don't auto-ban for rate limits alone (score is too low)
}

/**
 * Record threat from suspicious User-Agent
 * Call this when suspicious UA detected
 * 
 * @param {string} ip - Client IP
 * @param {string} userAgent - User-Agent string
 */
async function recordSuspiciousUserAgent(ip, userAgent) {
  const points = securityConfig.threatScoring.points.suspiciousUserAgent;
  await incrementThreatScore(ip, 'suspicious_user_agent', points);
  await checkAndBanIfHighThreat(ip);
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  incrementThreatScore,
  getThreatScore,
  getThreatLog,
  resetThreatScore,
  checkAndBanIfHighThreat,
  getThreatScoreSummary,
  recordValidationThreat,
  recordRateLimitThreat,
  recordSuspiciousUserAgent,
};
