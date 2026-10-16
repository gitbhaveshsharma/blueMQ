/**
 * Security Headers Middleware
 * 
 * Configures comprehensive security headers using helmet.
 * Protects against XSS, clickjacking, and MIME sniffing attacks.
 */

const helmet = require('helmet');
const securityConfig = require('../../config/security.config');

/**
 * Enhanced security headers middleware
 * @returns {Function} Express middleware
 */
function securityHeadersMiddleware() {
  // Skip if disabled
  if (!securityConfig.enabled.securityHeaders) {
    return (req, res, next) => next();
  }
  
  const config = securityConfig.headers;
  
  // Build helmet configuration
  const helmetConfig = {
    // Content Security Policy
    contentSecurityPolicy: config.csp.enabled ? {
      directives: config.csp.directives,
    } : false,
    
    // HTTP Strict Transport Security
    hsts: config.hsts.enabled ? {
      maxAge: config.hsts.maxAge,
      includeSubDomains: config.hsts.includeSubDomains,
      preload: config.hsts.preload,
    } : false,
    
    // Frame protection
    frameguard: {
      action: config.frameguard, // 'deny' or 'sameorigin'
    },
    
    // Referrer Policy
    referrerPolicy: {
      policy: config.referrerPolicy,
    },
    
    // X-Content-Type-Options: nosniff
    noSniff: config.noSniff,
    
    // X-XSS-Protection
    xssFilter: config.xssProtection,
    
    // Hide X-Powered-By
    hidePoweredBy: config.hidePoweredBy,
  };
  
  return helmet(helmetConfig);
}

/**
 * Custom security headers middleware
 * Adds additional headers not covered by helmet
 * 
 * @returns {Function} Express middleware
 */
function customSecurityHeaders(req, res, next) {
  // Skip if disabled
  if (!securityConfig.enabled.securityHeaders) {
    return next();
  }
  
  const config = securityConfig.headers;
  
  // Remove server identification headers
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Set additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', config.frameguard.toUpperCase());
  
  if (config.xssProtection) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }
  
  // Referrer-Policy
  res.setHeader('Referrer-Policy', config.referrerPolicy);
  
  // Permissions-Policy (formerly Feature-Policy)
  // Restrict access to sensitive browser features
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  securityHeadersMiddleware,
  customSecurityHeaders,
};
