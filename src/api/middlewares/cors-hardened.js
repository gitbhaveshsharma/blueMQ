/**
 * Hardened CORS Middleware
 * 
 * Whitelist-based CORS policy for production.
 * More restrictive than default cors() middleware.
 * 
 * PRODUCTION-SAFE: Defaults to permissive in dev, strict in production
 */

const cors = require('cors');
const securityConfig = require('../../config/security.config');

/**
 * Check if origin is allowed
 * 
 * @param {string} origin - Request origin
 * @param {array} allowedOrigins - List of allowed origins
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowedOrigins) {
  // No origin (non-browser requests, same-origin) always allowed
  if (!origin) {
    return true;
  }
  
  // Check for wildcard
  if (allowedOrigins.includes('*')) {
    return true;
  }
  
  // Check for exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Check for pattern match (e.g., *.example.com)
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith('*.')) {
      const domain = allowed.substring(2); // Remove *.
      if (origin.endsWith(`.${domain}`) || origin === `https://${domain}` || origin === `http://${domain}`) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Hardened CORS middleware factory
 * 
 * @returns {Function} Express middleware
 */
function hardenedCorsMiddleware() {
  // Skip if hardening is disabled (use default permissive CORS)
  if (!securityConfig.enabled.corsHardening) {
    console.log('[security] CORS hardening disabled, using permissive CORS');
    return cors();
  }
  
  const config = securityConfig.cors;
  const allowedOrigins = config.allowedOrigins;
  
  console.log('[security] CORS hardened mode:', {
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : 'same-origin only',
    credentials: config.credentials,
    methods: config.allowedMethods,
  });
  
  return cors({
    origin: function(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        console.warn('[security] CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS policy'));
      }
    },
    methods: config.allowedMethods,
    allowedHeaders: config.allowedHeaders,
    credentials: config.credentials,
    maxAge: config.maxAge, // Preflight cache duration
    optionsSuccessStatus: 204, // Some legacy browsers choke on 204
  });
}

/**
 * Get CORS configuration summary
 * Useful for debugging
 * 
 * @returns {object}
 */
function getCorsConfig() {
  return {
    enabled: securityConfig.enabled.corsHardening,
    allowedOrigins: securityConfig.cors.allowedOrigins,
    allowedMethods: securityConfig.cors.allowedMethods,
    allowedHeaders: securityConfig.cors.allowedHeaders,
    credentials: securityConfig.cors.credentials,
    maxAge: securityConfig.cors.maxAge,
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  hardenedCorsMiddleware,
  isOriginAllowed,
  getCorsConfig,
};
