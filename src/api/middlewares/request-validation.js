/**
 * Request Validation Middleware
 * 
 * Detects and blocks malicious request patterns:
 * - Path traversal attempts
 * - SQL injection patterns
 * - Common exploit paths
 * - Prototype pollution
 * - Oversized requests
 * 
 * PHASE 2: Integrated with threat scoring system
 */

const securityConfig = require('../../config/security.config');
const { incrementMetric } = require('../../utils/redis-security');

// Lazy-load threat scoring to avoid circular dependency
let threatScoring = null;
function getThreatScoring() {
  if (!threatScoring) {
    threatScoring = require('./threat-scoring');
  }
  return threatScoring;
}

// ─── Suspicious Pattern Definitions ────────────────────────────────────────

const PATTERNS = {
  // PHASE 1 & 2 PATTERNS
  // Path traversal: ../, ..\, url-encoded variants
  pathTraversal: /\.\.[\/\\]|%2e%2e[\/\\]|\.\.%2f|\.\.%5c/i,
  // SQL injection common patterns
  sqlInjection: /(union\s+select|or\s+1\s*=\s*1|'\s*or\s*'|admin'\s*--|1'\s*or\s*'1'\s*=\s*'1|\/\*|\*\/|;--|xp_|sp_executesql|exec\s*\(|execute\s*\()/i,
  // Common exploit paths
  exploitPaths: /\/(vendor|\.git|\.env|\.svn|\.DS_Store|wp-admin|wp-content|phpmyadmin|\.php|\.asp|\.aspx|\.jsp|eval-stdin|phpinfo|shell|cmd)/i,
  // Script injection
  scriptTags: /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  // Prototype pollution keys
  prototypeKeys: /(__proto__|constructor\.prototype|prototype\.)/,

  // PHASE 3 OWASP PATTERNS
  // Command injection: shell metacharacters, command chaining
  commandInjection: /[;&|]\s*(ls|cat|rm|wget|curl|bash|sh|cmd|powershell)|&&|\|\||`|\\x[0-9a-f]{2}/i,
  // XSS: script tags, event handlers, javascript protocol
  xss: /<script[\s\S]*?>|javascript:|onerror\s*=|onload\s*=|onclick\s*=|onmouseover\s*=|<iframe|<object|<embed|eval\s*\(|expression\s*\(/i,
  // NoSQL injection: MongoDB operators
  nosqlInjection: /\$ne[^a-z]|\$gt[^a-z]|\$lt[^a-z]|\$where|\$regex|\$or[^a-z]|\$and[^a-z]|\$nin|\$exists/i,
  // Scanner probes: backup files, version control, sensitive files
  scannerProbes: /(backup|\.bak|\.old|\.sql|\.tar|\.gz|\.zip|\.rar|sitemap\.xml|\.git\/|\.svn\/|\.hg\/|\.bzr\/|CVS\/|\.well-known\/security\.txt)|\.sql\.(gz|tar|zip|bak)|\.db\.(gz|tar|zip|bak)/i,
  // Template injection: Jinja2, ERB, JSP, Thymeleaf patterns
  templateInjection: /\{\{.*\}\}|\$\{.*\}|<%.*%>|\[@.*@\]/,
  // Header injection: CRLF injection for header smuggling
  headerInjection: /\r\n|\r|\n|%0d%0a|%0a%0d|%0d|%0a|%00/i,
};


/**
 * Check URL for suspicious patterns
 * @param {string} url - Request URL
 * @returns {{isSuspicious: boolean, reason: string|null, pattern: string|null}}
 */
function validateURL(url) {
  const config = securityConfig.validation;
  
  // Check URL length
  if (url.length > config.maxUrlLength) {
    return {
      isSuspicious: true,
      reason: 'URL exceeds maximum length',
      pattern: 'url_length',
    };
  }
  
  // Decode URL to catch encoded attacks
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch (e) {
    // Malformed URL encoding is suspicious
    return {
      isSuspicious: true,
      reason: 'Malformed URL encoding',
      pattern: 'invalid_encoding',
    };
  }
  
  // Check path traversal
  if (config.blockPathTraversal && PATTERNS.pathTraversal.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Path traversal attempt detected',
      pattern: 'path_traversal',
    };
  }
  
  // Check SQL injection
  if (config.blockSqlInjection && PATTERNS.sqlInjection.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'SQL injection pattern detected',
      pattern: 'sql_injection',
    };
  }
  
  // Check exploit paths
  // Check exploit paths
  if (config.blockPhpPaths && PATTERNS.exploitPaths.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Exploit path access attempt',
      pattern: 'exploit_path',
    };
  }
  
  // PHASE 3 CHECKS
  // Check command injection
  if (PATTERNS.commandInjection.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Command injection attempt detected',
      pattern: 'command_injection',
    };
  }
  
  // Check XSS patterns
  if (PATTERNS.xss.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'XSS attack pattern detected',
      pattern: 'xss',
    };
  }
  
  // Check NoSQL injection
  if (PATTERNS.nosqlInjection.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'NoSQL injection pattern detected',
      pattern: 'nosql_injection',
    };
  }
  
  // Check scanner probes
  if (PATTERNS.scannerProbes.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Security scanner probe detected',
      pattern: 'scanner_probe',
    };
  }
  
  // Check template injection
  if (PATTERNS.templateInjection.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Template injection attempt detected',
      pattern: 'template_injection',
    };
  }
  
  // Check header injection
  if (PATTERNS.headerInjection.test(decodedUrl)) {
    return {
      isSuspicious: true,
      reason: 'Header injection attempt detected',
      pattern: 'header_injection',
    };
  }
  
  return { isSuspicious: false, reason: null, pattern: null };
  
  return { isSuspicious: false, reason: null, pattern: null };
}

/**
 * Recursively check object for prototype pollution attempts
 * @param {object} obj - Object to check
 * @param {string} path - Current path (for error reporting)
 * @returns {{isValid: boolean, reason: string|null}}
 */
function validatePayload(obj, path = 'body') {
  if (!obj || typeof obj !== 'object') {
    return { isValid: true, reason: null };
  }
  
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    
    // Check for dangerous keys
    if (PATTERNS.prototypeKeys.test(key)) {
      return {
        isValid: false,
        reason: `Prototype pollution attempt: ${path}.${key}`,
      };
    }
    
    // Recursively check nested objects
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const result = validatePayload(obj[key], `${path}.${key}`);
      if (!result.isValid) {
        return result;
      }
    }
  }
  
  return { isValid: true, reason: null };
}

/**
 * Check User-Agent for suspicious patterns
 * @param {string} userAgent - User-Agent header
 * @returns {boolean} True if suspicious
 */
function isSuspiciousUserAgent(userAgent) {
  if (!userAgent) return false;
  
  const suspiciousPatterns = [
    /sqlmap/i,
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /acunetix/i,
    /nessus/i,
    /openvas/i,
    /metasploit/i,
    /burpsuite/i,
    /w3af/i,
    /havij/i,
    /pangolin/i,
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(userAgent));
}

// ─── Middleware ────────────────────────────────────────────────────────────

/**
 * Request validation middleware factory
 * @returns {Function} Express middleware
 */
function requestValidationMiddleware(req, res, next) {
  // Skip if disabled
  if (!securityConfig.enabled.requestValidation) {
    return next();
  }
  
  const clientIP = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || '';
  
  // 1. Validate URL
  const urlValidation = validateURL(req.originalUrl || req.url);
  if (urlValidation.isSuspicious) {
    console.warn('[security] Blocked request:', {
      ip: clientIP,
      url: req.originalUrl,
      reason: urlValidation.reason,
      pattern: urlValidation.pattern,
      userAgent,
    });
    
    incrementMetric('requests.blocked.validation');
    incrementMetric(`requests.blocked.${urlValidation.pattern}`);
    
    // PHASE 2: Record in threat scoring system
    if (securityConfig.enabled.threatScoring) {
      getThreatScoring().recordValidationThreat(clientIP, urlValidation.pattern)
        .catch(err => console.error('[security] Threat scoring error:', err.message));
    }
    
    // Return 404 for exploit paths (don't reveal blocking logic)
    if (urlValidation.pattern === 'exploit_path') {
      return res.status(404).json({ error: 'Not found' });
    }
    
    return res.status(400).json({
      error: 'Bad request',
      message: urlValidation.reason,
    });
  }
  
  // 2. Validate Content-Type for body-containing requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type') || '';
    
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      console.warn('[security] Invalid Content-Type:', {
        ip: clientIP,
        method: req.method,
        contentType,
      });
      
      incrementMetric('requests.blocked.invalid_content_type');
      
      return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Content-Type must be application/json',
      });
    }
  }
  
  // 3. Validate request body for prototype pollution
  if (req.body && typeof req.body === 'object') {
    const payloadValidation = validatePayload(req.body);
    if (!payloadValidation.isValid) {
      console.warn('[security] Blocked payload:', {
        ip: clientIP,
        reason: payloadValidation.reason,
      });
      
      incrementMetric('requests.blocked.prototype_pollution');
      
      // PHASE 2: Record in threat scoring
      if (securityConfig.enabled.threatScoring) {
        getThreatScoring().incrementThreatScore(clientIP, 'prototype_pollution', 10)
          .catch(err => console.error('[security] Threat scoring error:', err.message));
      }
      
      return res.status(400).json({
        error: 'Bad request',
        message: 'Invalid payload structure',
      });
    }
  }
  
  // 4. Check for suspicious User-Agent
  if (isSuspiciousUserAgent(userAgent)) {
    console.warn('[security] Suspicious User-Agent:', {
      ip: clientIP,
      userAgent,
    });
    
    incrementMetric('requests.suspicious_user_agent');
    
    // PHASE 2: Record in threat scoring (but don't block)
    if (securityConfig.enabled.threatScoring) {
      getThreatScoring().recordSuspiciousUserAgent(clientIP, userAgent)
        .catch(err => console.error('[security] Threat scoring error:', err.message));
    }
    // Don't block, but increment metric for monitoring
  }
  
  next();
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  requestValidationMiddleware,
  validateURL,
  validatePayload,
  isSuspiciousUserAgent,
};
