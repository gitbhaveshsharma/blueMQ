/**
 * Security Configuration Module
 * 
 * Centralized configuration for all security middleware components.
 * All settings load from environment variables with production-safe defaults.
 * 
 * Environment-driven design allows per-deployment tuning without code changes.
 */

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Parse boolean environment variable
 * @param {string} name - Environment variable name
 * @param {boolean} fallback - Default value
 * @returns {boolean}
 */
function parseBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;

  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;

  throw new Error(`[security-config] Invalid boolean for ${name}: "${raw}"`);
}

/**
 * Parse number environment variable with validation
 * @param {string} name - Environment variable name
 * @param {number} fallback - Default value
 * @param {object} options - Validation options {min, max}
 * @returns {number}
 */
function parseNumber(name, fallback, options = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;

  const num = Number.parseInt(raw, 10);

  if (!Number.isInteger(num)) {
    throw new Error(`[security-config] Invalid number for ${name}: "${raw}"`);
  }

  if (options.min !== undefined && num < options.min) {
    throw new Error(`[security-config] ${name} must be >= ${options.min}, got ${num}`);
  }

  if (options.max !== undefined && num > options.max) {
    throw new Error(`[security-config] ${name} must be <= ${options.max}, got ${num}`);
  }

  return num;
}

/**
 * Parse comma-separated list
 * @param {string} name - Environment variable name
 * @param {array} fallback - Default array
 * @returns {array}
 */
function parseList(name, fallback = []) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Parse IP whitelist with CIDR support validation
 * @param {string} name - Environment variable name
 * @returns {array}
 */
function parseIPList(name) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return [];

  const items = raw.split(',').map(item => item.trim()).filter(Boolean);

  // Basic validation (IPv4, IPv6, CIDR notation)
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-fA-F:.]+)(\/\d{1,3})?$|^::1$|^localhost$/;
  
  items.forEach(ip => {
    if (!ipPattern.test(ip)) {
      throw new Error(`[security-config] Invalid IP in ${name}: "${ip}"`);
    }
  });

  return items;
}

// ─── Configuration Object ──────────────────────────────────────────────────

const securityConfig = {
  // ─── Feature Toggles ───────────────────────────────────────────────────
  enabled: {
    rateLimiting: parseBoolean('SECURITY_ENABLE_RATE_LIMITING', true),
    requestValidation: parseBoolean('SECURITY_ENABLE_REQUEST_VALIDATION', true),
    bruteForceProtection: parseBoolean('SECURITY_ENABLE_BRUTE_FORCE_PROTECTION', false),
    ipBlacklist: parseBoolean('SECURITY_ENABLE_IP_BLACKLIST', false),
    threatScoring: parseBoolean('SECURITY_ENABLE_THREAT_SCORING', false),
    securityHeaders: parseBoolean('SECURITY_ENABLE_SECURITY_HEADERS', true),
    corsHardening: parseBoolean('SECURITY_ENABLE_CORS_HARDENING', false),
  },

  // ─── Rate Limiting ─────────────────────────────────────────────────────
  rateLimiting: {
    // Global rate limit (per IP)
    global: {
      windowMs: parseNumber('SECURITY_RATE_LIMIT_GLOBAL_WINDOW_MS', 15 * 60 * 1000, { min: 1000 }), // 15 minutes
      max: parseNumber('SECURITY_RATE_LIMIT_GLOBAL_MAX', 1000, { min: 1 }), // 1000 requests
      message: 'Too many requests from this IP. Please try again later.',
    },

    // Authentication endpoints (/auth/*)
    auth: {
      windowMs: parseNumber('SECURITY_RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000, { min: 1000 }), // 15 minutes
      max: parseNumber('SECURITY_RATE_LIMIT_AUTH_MAX', 10, { min: 1 }), // 10 requests
      message: 'Too many authentication attempts. Please try again later.',
    },

    // Notification endpoint (/notify)
    notify: {
      windowMs: parseNumber('SECURITY_RATE_LIMIT_NOTIFY_WINDOW_MS', 60 * 1000, { min: 1000 }), // 1 minute
      max: parseNumber('SECURITY_RATE_LIMIT_NOTIFY_MAX', 100, { min: 1 }), // 100 requests
      message: 'Too many notification requests. Please slow down.',
    },

    // Schedule trigger endpoint (/schedules/:id/trigger)
    schedulesTrigger: {
      windowMs: parseNumber('SECURITY_RATE_LIMIT_SCHEDULES_TRIGGER_WINDOW_MS', 60 * 60 * 1000, { min: 1000 }), // 1 hour
      max: parseNumber('SECURITY_RATE_LIMIT_SCHEDULES_TRIGGER_MAX', 30, { min: 1 }), // 30 requests
      message: 'Too many manual schedule triggers. Please wait before retrying.',
    },
  },

  // ─── Request Validation ────────────────────────────────────────────────
  validation: {
    maxUrlLength: parseNumber('SECURITY_MAX_URL_LENGTH', 2048, { min: 100, max: 10000 }),
    maxHeaderSize: parseNumber('SECURITY_MAX_HEADER_SIZE', 8192, { min: 1024, max: 32768 }),
    blockPhpPaths: parseBoolean('SECURITY_BLOCK_PHP_PATHS', true),
    blockPathTraversal: parseBoolean('SECURITY_BLOCK_PATH_TRAVERSAL', true),
    blockSqlInjection: parseBoolean('SECURITY_BLOCK_SQL_INJECTION', true),
    blockPrototypePollution: parseBoolean('SECURITY_BLOCK_PROTOTYPE_POLLUTION', true),
  },

  // ─── Brute Force Protection ────────────────────────────────────────────
  bruteForce: {
    // Cooldown thresholds: failures → cooldown seconds
    thresholds: [
      { failures: parseNumber('SECURITY_BRUTE_FORCE_THRESHOLD_1', 3, { min: 1 }), cooldownSeconds: parseNumber('SECURITY_BRUTE_FORCE_COOLDOWN_1', 60, { min: 1 }) },
      { failures: parseNumber('SECURITY_BRUTE_FORCE_THRESHOLD_2', 5, { min: 1 }), cooldownSeconds: parseNumber('SECURITY_BRUTE_FORCE_COOLDOWN_2', 900, { min: 1 }) },
      { failures: parseNumber('SECURITY_BRUTE_FORCE_THRESHOLD_3', 10, { min: 1 }), cooldownSeconds: parseNumber('SECURITY_BRUTE_FORCE_COOLDOWN_3', 3600, { min: 1 }) },
      { failures: parseNumber('SECURITY_BRUTE_FORCE_THRESHOLD_4', 20, { min: 1 }), cooldownSeconds: parseNumber('SECURITY_BRUTE_FORCE_COOLDOWN_4', 86400, { min: 1 }) },
    ],
    maxAttempts: parseNumber('SECURITY_BRUTE_FORCE_MAX_ATTEMPTS', 20, { min: 1 }), // Auto-ban after this
    trackingWindowSeconds: parseNumber('SECURITY_BRUTE_FORCE_TRACKING_WINDOW', 86400, { min: 60 }), // 24 hours
  },

  // ─── CORS Configuration ────────────────────────────────────────────────
  cors: {
    allowedOrigins: parseList('SECURITY_CORS_ALLOWED_ORIGINS', process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173']),
    allowedMethods: parseList('SECURITY_CORS_ALLOWED_METHODS', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    allowedHeaders: parseList('SECURITY_CORS_ALLOWED_HEADERS', ['Content-Type', 'Authorization', 'x-api-key']),
    credentials: parseBoolean('SECURITY_CORS_CREDENTIALS', true),
    maxAge: parseNumber('SECURITY_CORS_MAX_AGE', 86400, { min: 0 }), // 24 hours
  },

  // ─── Security Headers ──────────────────────────────────────────────────
  headers: {
    hsts: {
      enabled: parseBoolean('SECURITY_ENABLE_HSTS', true),
      maxAge: parseNumber('SECURITY_HSTS_MAX_AGE', 31536000, { min: 0 }), // 1 year
      includeSubDomains: parseBoolean('SECURITY_HSTS_INCLUDE_SUBDOMAINS', true),
      preload: parseBoolean('SECURITY_HSTS_PRELOAD', true),
    },
    csp: {
      enabled: parseBoolean('SECURITY_ENABLE_CSP', true),
      // CSP directives can be customized via environment
      directives: {
        defaultSrc: parseList('SECURITY_CSP_DEFAULT_SRC', ["'self'"]),
        styleSrc: parseList('SECURITY_CSP_STYLE_SRC', ["'self'", "'unsafe-inline'"]),
        scriptSrc: parseList('SECURITY_CSP_SCRIPT_SRC', ["'self'"]),
        imgSrc: parseList('SECURITY_CSP_IMG_SRC', ["'self'", 'data:', 'https:']),
        connectSrc: parseList('SECURITY_CSP_CONNECT_SRC', ["'self'"]),
        fontSrc: parseList('SECURITY_CSP_FONT_SRC', ["'self'"]),
        objectSrc: parseList('SECURITY_CSP_OBJECT_SRC', ["'none'"]),
        mediaSrc: parseList('SECURITY_CSP_MEDIA_SRC', ["'self'"]),
        frameSrc: parseList('SECURITY_CSP_FRAME_SRC', ["'none'"]),
      },
    },
    referrerPolicy: process.env.SECURITY_REFERRER_POLICY || 'no-referrer',
    frameguard: process.env.SECURITY_FRAMEGUARD || 'deny',
    xssProtection: parseBoolean('SECURITY_XSS_PROTECTION', true),
    noSniff: parseBoolean('SECURITY_NO_SNIFF', true),
    hidePoweredBy: parseBoolean('SECURITY_HIDE_POWERED_BY', true),
  },

  // ─── IP Access Control ─────────────────────────────────────────────────
  ipAccess: {
    whitelist: parseIPList('SECURITY_WHITELIST_IPS'),
    defaultBanDuration: parseNumber('SECURITY_DEFAULT_BAN_DURATION', 86400, { min: 0 }), // 24 hours, 0 = permanent
  },

  // ─── Threat Scoring ────────────────────────────────────────────────────
  threatScoring: {
    // Point values for different threat types
    points: {
      pathTraversal: parseNumber('SECURITY_THREAT_POINTS_PATH_TRAVERSAL', 10, { min: 0 }),
      sqlInjection: parseNumber('SECURITY_THREAT_POINTS_SQL_INJECTION', 15, { min: 0 }),
      exploitPath: parseNumber('SECURITY_THREAT_POINTS_EXPLOIT_PATH', 5, { min: 0 }),
      failedAuth: parseNumber('SECURITY_THREAT_POINTS_FAILED_AUTH', 2, { min: 0 }),
      rateLimitHit: parseNumber('SECURITY_THREAT_POINTS_RATE_LIMIT', 1, { min: 0 }),
      suspiciousUserAgent: parseNumber('SECURITY_THREAT_POINTS_SUSPICIOUS_UA', 3, { min: 0 }),
    },
    threshold: parseNumber('SECURITY_THREAT_THRESHOLD', 50, { min: 1 }), // Auto-ban at this score
    autoBan: parseBoolean('SECURITY_THREAT_AUTO_BAN', false),
    decayHours: parseNumber('SECURITY_THREAT_DECAY_HOURS', 24, { min: 1 }), // Score resets after this

    /**
     * Regex patterns for paths commonly probed by scanners and bots.
     * Any 404 matching one of these patterns will be scored as an
     * `exploit_path` threat event (see registerHttpHandlers in index.js).
     *
     * Add new patterns here — no code changes elsewhere needed.
     */
    sensitivePaths: [
      /\/wp-login/i,
      /\/wp-admin/i,
      /\/xmlrpc/i,
      /\/admin/i,
      /\/actuator/i,
      /\/\.env/i,
      /\/config\./i,
      /\/phpmyadmin/i,
      /\/shell/i,
      /\/cgi-bin/i,
      /\/\.git/i,
      /\/auth\/signin/i,
      /\/api\/auth\/signin/i,
      /\/user\/login/i,
      /\/account\/login/i,
    ],
  },

  // ─── Admin API ─────────────────────────────────────────────────────────
  admin: {
    enabled: parseBoolean('SECURITY_ADMIN_ENABLED', true),
    serviceSecretKey: process.env.SERVICE_SECRET_KEY || '',
  },
};

// ─── Validation ────────────────────────────────────────────────────────────

// Validate brute force thresholds are in ascending order
const thresholds = securityConfig.bruteForce.thresholds;
for (let i = 1; i < thresholds.length; i++) {
  if (thresholds[i].failures <= thresholds[i - 1].failures) {
    throw new Error('[security-config] Brute force thresholds must be in ascending order');
  }
}

// Warn if admin API enabled without service secret
if (securityConfig.admin.enabled && !securityConfig.admin.serviceSecretKey) {
  console.warn('[security-config] Warning: Admin API enabled but SERVICE_SECRET_KEY not set. Admin endpoints will be unprotected!');
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = securityConfig;
