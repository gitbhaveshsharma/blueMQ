/**
 * Rate Limiting Middleware
 * 
 * Multi-layer rate limiting:
 * - Global per-IP limits
 * - Endpoint-specific limits
 * - API key-based limits
 * 
 * Redis-backed for multi-process support (PM2).
 */

const securityConfig = require('../../config/security.config');
const { REDIS_KEYS, incrementWithTTL, getTTL, incrementMetric } = require('../../utils/redis-security');

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Extract client IP from request
 * Handles X-Forwarded-For header for reverse proxy setups
 * 
 * @param {object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
  // Check X-Forwarded-For header (nginx/load balancer)
  const forwarded = req.get('X-Forwarded-For');
  if (forwarded) {
    // Take first IP in the list (original client)
    return forwarded.split(',')[0].trim();
  }
  
  // Fallback to direct connection IP
  return req.ip || req.connection.remoteAddress || '0.0.0.0';
}

/**
 * Check if IP is whitelisted
 * Supports exact match and CIDR notation (basic)
 * 
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
function isWhitelisted(ip) {
  const whitelist = securityConfig.ipAccess.whitelist;
  if (!whitelist || whitelist.length === 0) return false;
  
  // Check for exact match or localhost aliases
  if (whitelist.includes(ip)) return true;
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.0.0.1')) {
    return whitelist.includes('localhost') || whitelist.includes('127.0.0.1') || whitelist.includes('::1');
  }
  
  // Basic CIDR check (e.g., 192.168.1.0/24)
  // For production, consider using a library like 'ip-range-check'
  for (const entry of whitelist) {
    if (entry.includes('/')) {
      // Simple CIDR match (IPv4 only for now)
      const [network, bits] = entry.split('/');
      if (ip.startsWith(network.split('.').slice(0, Math.floor(bits / 8)).join('.'))) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Calculate window identifier for rate limit key
 * Creates a time bucket that resets at window intervals
 * 
 * @param {number} windowMs - Window size in milliseconds
 * @returns {number} Window identifier
 */
function getWindowIdentifier(windowMs) {
  return Math.floor(Date.now() / windowMs);
}

/**
 * Add rate limit headers to response
 * 
 * @param {object} res - Express response object
 * @param {number} limit - Maximum requests allowed
 * @param {number} remaining - Requests remaining
 * @param {number} resetTime - Window reset timestamp
 */
function setRateLimitHeaders(res, limit, remaining, resetTime) {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.floor(resetTime / 1000));
}

// ─── Global Rate Limiter ───────────────────────────────────────────────────

/**
 * Global rate limiter (per IP)
 * 
 * @param {object} options - Rate limit configuration
 * @returns {Function} Express middleware
 */
function globalRateLimiter(options = {}) {
  const config = options.config || securityConfig.rateLimiting.global;
  const windowMs = options.windowMs || config.windowMs;
  const max = options.max || config.max;
  const message = options.message || config.message;
  
  return async function(req, res, next) {
    // Skip if disabled
    if (!securityConfig.enabled.rateLimiting) {
      return next();
    }
    
    const clientIP = getClientIP(req);
    
    // Bypass for whitelisted IPs
    if (isWhitelisted(clientIP)) {
      return next();
    }
    
    const window = getWindowIdentifier(windowMs);
    const key = REDIS_KEYS.RATE_LIMIT_GLOBAL(clientIP, window);
    const ttlSeconds = Math.ceil(windowMs / 1000);
    
    try {
      const count = await incrementWithTTL(key, ttlSeconds);
      const remaining = max - count;
      const resetTime = (window + 1) * windowMs;
      
      setRateLimitHeaders(res, max, remaining, resetTime);
      
      if (count > max) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        
        console.warn('[security] Rate limit exceeded:', {
          ip: clientIP,
          limit: max,
          window: `${windowMs / 1000}s`,
          count,
        });
        
        incrementMetric('rate_limit.exceeded.global');
        
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Too Many Requests',
          message,
          retryAfter,
        });
      }
      
      next();
    } catch (error) {
      console.error('[security] Rate limiter error:', error.message);
      // Fail-open: allow request on Redis errors
      next();
    }
  };
}

// ─── Endpoint-Specific Rate Limiter ────────────────────────────────────────

/**
 * Endpoint-specific rate limiter
 * 
 * @param {string} endpoint - Endpoint identifier (e.g., 'auth', 'notify')
 * @param {object} options - Rate limit configuration
 * @returns {Function} Express middleware
 */
function endpointRateLimiter(endpoint, options = {}) {
  const windowMs = options.windowMs;
  const max = options.max;
  const message = options.message;
  const trackBy = options.trackBy || 'ip'; // 'ip' or 'apiKey'
  
  if (!windowMs || !max) {
    throw new Error('[rate-limiting] endpointRateLimiter requires windowMs and max options');
  }
  
  return async function(req, res, next) {
    // Skip if disabled
    if (!securityConfig.enabled.rateLimiting) {
      return next();
    }
    
    const clientIP = getClientIP(req);
    
    // Bypass for whitelisted IPs (even for endpoint-specific limits)
    if (isWhitelisted(clientIP)) {
      return next();
    }
    
    let identifier = clientIP;
    
    // Use API key as identifier if specified
    if (trackBy === 'apiKey') {
      const apiKey = req.get('x-api-key') || req.query.apiKey;
      if (!apiKey) {
        // No API key = fall back to IP
        identifier = clientIP;
      } else {
        // Hash API key for privacy (first 8 chars)
        identifier = apiKey.substring(0, 8);
      }
    }
    
    const window = getWindowIdentifier(windowMs);
    const key = REDIS_KEYS.RATE_LIMIT_ENDPOINT(endpoint, identifier, window);
    const ttlSeconds = Math.ceil(windowMs / 1000);
    
    try {
      const count = await incrementWithTTL(key, ttlSeconds);
      const remaining = max - count;
      const resetTime = (window + 1) * windowMs;
      
      // Use custom header prefix for endpoint-specific limits
      res.setHeader(`X-RateLimit-${endpoint}-Limit`, max);
      res.setHeader(`X-RateLimit-${endpoint}-Remaining`, Math.max(0, remaining));
      res.setHeader(`X-RateLimit-${endpoint}-Reset`, Math.floor(resetTime / 1000));
      
      if (count > max) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        
        console.warn('[security] Endpoint rate limit exceeded:', {
          endpoint,
          identifier: trackBy === 'apiKey' ? `${identifier}...` : identifier,
          limit: max,
          window: `${windowMs / 1000}s`,
          count,
        });
        
        incrementMetric(`rate_limit.exceeded.${endpoint}`);
        
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: message || `Too many requests to ${endpoint} endpoint`,
          retryAfter,
        });
      }
      
      next();
    } catch (error) {
      console.error('[security] Endpoint rate limiter error:', error.message);
      // Fail-open: allow request on Redis errors
      next();
    }
  };
}

// ─── API Key Rate Limiter ──────────────────────────────────────────────────

/**
 * API key rate limiter
 * 
 * @param {object} options - Rate limit configuration
 * @returns {Function} Express middleware
 */
function apiKeyRateLimiter(options = {}) {
  const windowMs = options.windowMs;
  const max = options.max;
  const message = options.message;
  
  if (!windowMs || !max) {
    throw new Error('[rate-limiting] apiKeyRateLimiter requires windowMs and max options');
  }
  
  return async function(req, res, next) {
    // Skip if disabled
    if (!securityConfig.enabled.rateLimiting) {
      return next();
    }
    
    const apiKey = req.get('x-api-key') || req.query.apiKey;
    
    if (!apiKey) {
      // No API key = skip this rate limiter
      return next();
    }
    
    // Hash API key for privacy
    const keyHash = apiKey.substring(0, 8);
    
    const window = getWindowIdentifier(windowMs);
    const key = REDIS_KEYS.RATE_LIMIT_APIKEY(keyHash, window);
    const ttlSeconds = Math.ceil(windowMs / 1000);
    
    try {
      const count = await incrementWithTTL(key, ttlSeconds);
      const remaining = max - count;
      const resetTime = (window + 1) * windowMs;
      
      setRateLimitHeaders(res, max, remaining, resetTime);
      
      if (count > max) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        
        console.warn('[security] API key rate limit exceeded:', {
          keyHash: `${keyHash}...`,
          limit: max,
          window: `${windowMs / 1000}s`,
          count,
        });
        
        incrementMetric('rate_limit.exceeded.apikey');
        
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: message || 'API key rate limit exceeded',
          retryAfter,
        });
      }
      
      next();
    } catch (error) {
      console.error('[security] API key rate limiter error:', error.message);
      // Fail-open: allow request on Redis errors
      next();
    }
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  globalRateLimiter,
  endpointRateLimiter,
  apiKeyRateLimiter,
  getClientIP,
  isWhitelisted,
};
