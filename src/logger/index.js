const { AsyncLocalStorage } = require("async_hooks");
const { randomUUID } = require("crypto");
const util = require("util");
const winston = require("winston");

// OTel API: provides trace context when telemetry is enabled.
// When telemetry is disabled or no span is active, getActiveSpan() returns
// undefined and isSpanContextValid() returns false — both handled gracefully.
const { trace, isSpanContextValid } = require("@opentelemetry/api");

const requestContextStorage = new AsyncLocalStorage();

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_TIMEZONE =
  process.env.LOG_TIMEZONE || process.env.TZ || "Asia/Kolkata";
const LOG_SERVICE_NAME = process.env.LOG_SERVICE_NAME || "blueMQ";

function getTimezoneTimestamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(new Date());

  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}.${pick("fractionalSecond")}`;
}

/**
 * Inject OTel trace_id and span_id from the currently active span (if any).
 * When telemetry is disabled or no span is active, this is a no-op.
 * WinstonInstrumentation also injects these fields; this format is a fallback
 * ensuring trace context appears even if instrumentation hasn't patched yet.
 */
const injectTraceContext = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    if (isSpanContextValid(ctx)) {
      info.trace_id = ctx.traceId;
      info.span_id = ctx.spanId;
      info.trace_flags = `0${ctx.traceFlags.toString(16)}`;
    }
  }
  return info;
});

const injectRequestContext = winston.format((info) => {
  const context = requestContextStorage.getStore();
  if (!context) return info;

  info.requestId = info.requestId || context.requestId;
  info.endpoint = info.endpoint || context.endpoint;
  info.method = info.method || context.method;
  info.appId = info.appId || context.appId || undefined;
  return info;
});

const normalizeMessage = winston.format((info) => {
  if (typeof info.message !== "string") {
    info.message = util.inspect(info.message, {
      depth: 6,
      breakLength: 100,
      compact: true,
    });
  }
  return info;
});

/**
 * Redact sensitive field values from structured log data.
 *
 * Only walks object keys — does NOT scan free-text message strings (too
 * expensive and error-prone). Covers secrets, tokens, API keys, and PII
 * fields (email, phone, recipient) that must not appear in log pipelines.
 *
 * Depth-limited to 4 levels to avoid performance impact on large payloads.
 */
const SENSITIVE_KEYS_RE =
  /^(password|passwd|token|access_token|refresh_token|id_token|secret|client_secret|api_key|apikey|access_key|x-api-key|x_api_key|authorization|auth_token|private_key|privatekey|otp|pin|cvv|card_number|email|phone|mobile|recipient|to_address|recipient_email|recipient_phone)$/i;

function redactObject(obj, depth) {
  if (depth > 4 || obj === null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS_RE.test(key)) {
      obj[key] = "[REDACTED]";
    } else {
      redactObject(obj[key], depth + 1);
    }
  }
}

const redactSensitive = winston.format((info) => {
  redactObject(info, 0);
  return info;
});

function formatMeta(info) {
  // Fields rendered separately in the console line or OTel / JSON output
  const skip = new Set([
    "level",
    "message",
    "timestamp",
    "service",
    "requestId",
    "endpoint",
    "method",
    "stack",
    "appId",
    // OTel trace context — shown in contextBits or JSON; skip from inline meta
    "trace_id",
    "span_id",
    "trace_flags",
  ]);

  const meta = {};
  for (const [key, value] of Object.entries(info)) {
    if (!skip.has(key)) {
      meta[key] = value;
    }
  }

  if (Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${util.inspect(meta, {
    depth: 5,
    breakLength: 120,
    compact: true,
    colors: false,
  })}`;
}

const consoleLineFormatter = winston.format.printf((info) => {
  const contextBits = [];
  if (info.method && info.endpoint)
    contextBits.push(`${info.method} ${info.endpoint}`);
  else if (info.endpoint) contextBits.push(info.endpoint);
  if (info.requestId) contextBits.push(`req:${info.requestId}`);
  if (info.appId) contextBits.push(`app:${info.appId}`);
  // Show abbreviated trace_id in dev for quick copy-paste into Tempo / LGTM
  if (info.trace_id) contextBits.push(`trace:${info.trace_id.slice(0, 8)}`);

  const context = contextBits.length ? ` [${contextBits.join(" | ")}]` : "";
  const stack = info.stack ? `\n${info.stack}` : "";

  return `${info.timestamp} ${LOG_TIMEZONE} [${info.level}] [${info.service}]${context} ${info.message}${formatMeta(info)}${stack}`;
});

/**
 * Colorful, structured formatter for security and general logs.
 * Works in both dev and production — makes logs human-readable.
 */
const colorfulFormatter = winston.format.printf((info) => {
  // ANSI color codes
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Log levels
    error: '\x1b[31m',    // red
    warn: '\x1b[33m',     // yellow
    info: '\x1b[36m',     // cyan
    debug: '\x1b[35m',    // magenta
    
    // Components
    timestamp: '\x1b[90m', // gray
    service: '\x1b[96m',   // bright cyan
    security: '\x1b[91m',  // bright red
    http: '\x1b[92m',      // bright green
    db: '\x1b[94m',        // bright blue
    ip: '\x1b[93m',        // bright yellow
    endpoint: '\x1b[95m',  // bright magenta
  };

  // Level color
  const levelColor = colors[info.level] || colors.info;
  const levelStr = `${levelColor}${info.level.toUpperCase().padEnd(5)}${colors.reset}`;
  
  // Timestamp
  const timeStr = `${colors.timestamp}${info.timestamp}${colors.reset}`;
  
  // Service tag
  const serviceStr = `${colors.service}[${info.service}]${colors.reset}`;
  
  // Context (endpoint, method, requestId, etc.)
  const contextBits = [];
  if (info.method && info.endpoint) {
    contextBits.push(`${colors.endpoint}${info.method} ${info.endpoint}${colors.reset}`);
  } else if (info.endpoint) {
    contextBits.push(`${colors.endpoint}${info.endpoint}${colors.reset}`);
  }
  if (info.ip) contextBits.push(`${colors.ip}${info.ip}${colors.reset}`);
  if (info.requestId) contextBits.push(`${colors.dim}req:${info.requestId.slice(0, 8)}${colors.reset}`);
  if (info.trace_id) contextBits.push(`${colors.dim}trace:${info.trace_id.slice(0, 8)}${colors.reset}`);
  
  const context = contextBits.length ? ` ${contextBits.join(' ')}` : '';
  
  // Main message - detect category from message prefix
  let message = info.message;
  let messageColor = colors.reset;
  
  if (message.includes('[security]')) {
    messageColor = colors.security;
  } else if (message.includes('[http]')) {
    messageColor = colors.http;
  } else if (message.includes('[db]')) {
    messageColor = colors.db;
  }
  
  // Format security-specific fields in a structured way
  let details = '';
  if (message.includes('[security]')) {
    const detailLines = [];
    
    if (info.statusCode) {
      const statusColor = info.statusCode >= 500 ? colors.error : 
                         info.statusCode >= 400 ? colors.warn : colors.info;
      detailLines.push(`  ${colors.dim}Status:${colors.reset} ${statusColor}${info.statusCode}${colors.reset}`);
    }
    
    if (info.userAgent) {
      detailLines.push(`  ${colors.dim}User-Agent:${colors.reset} ${info.userAgent.slice(0, 60)}${info.userAgent.length > 60 ? '...' : ''}`);
    }
    
    if (info.durationMs) {
      detailLines.push(`  ${colors.dim}Duration:${colors.reset} ${info.durationMs}ms`);
    }
    
    if (detailLines.length > 0) {
      details = '\n' + detailLines.join('\n');
    }
  }
  
  // Stack trace if error
  const stack = info.stack ? `\n${colors.dim}${info.stack}${colors.reset}` : '';
  
  return `${timeStr} ${levelStr} ${serviceStr}${context}\n  ${messageColor}${message}${colors.reset}${details}${stack}`;
});

/**
 * Build the console transport.
 *
 * When LOG_FORMAT=colorful (default in production now), use colorful formatter.
 * When LOG_FORMAT=json, use JSON (for log aggregation systems).
 * Development: always colorful.
 */
function buildConsoleTransport() {
  const logFormat = process.env.LOG_FORMAT || 'colorful';
  
  if (logFormat === 'json') {
    return new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    });
  }
  
  // Colorful format (default for both dev and production)
  return new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: getTimezoneTimestamp }),
      colorfulFormatter,
    ),
  });
}

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: LOG_SERVICE_NAME },
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    injectTraceContext(),    // OTel trace_id / span_id from active span
    injectRequestContext(),  // requestId / endpoint / appId from AsyncLocalStorage
    normalizeMessage(),
    redactSensitive(),       // scrub tokens, keys, emails, phones
  ),
  transports: [buildConsoleTransport()],
});

logger.exitOnError = false;

let consoleInterceptorsInstalled = false;

function setRequestContext(values) {
  const context = requestContextStorage.getStore();
  if (context) {
    Object.assign(context, values);
  }
}

function requestContextMiddleware(req, res, next) {
  const headerId = req.headers["x-request-id"];
  const requestId =
    Array.isArray(headerId) && headerId.length > 0
      ? headerId[0]
      : headerId || randomUUID();

  const context = {
    requestId,
    method: req.method,
    endpoint: req.originalUrl || req.url,
  };

  res.setHeader("x-request-id", requestId);
  requestContextStorage.run(context, next);
}

function requestLoggingMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const roundedDurationMs = Number(durationMs.toFixed(1));
    const statusCode = res.statusCode;
    const level =
      statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    logger.log({
      level,
      message: `[http] ${req.method} ${req.originalUrl} ${statusCode} ${roundedDurationMs}ms`,
      statusCode,
      durationMs: roundedDurationMs,
      endpoint: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      appId: req.appId,
    });
  });

  next();
}

function installConsoleInterceptors() {
  if (consoleInterceptorsInstalled) return;
  if (
    String(process.env.LOG_INTERCEPT_CONSOLE || "true").toLowerCase() ===
    "false"
  ) {
    return;
  }

  consoleInterceptorsInstalled = true;

  const toPayload = (args) => {
    if (!args.length) return { message: "" };

    const firstError = args.find((arg) => arg instanceof Error);
    const messageArgs = args.map((arg) =>
      arg instanceof Error ? arg.message : arg,
    );
    const message = util.format(...messageArgs);

    return {
      message,
      stack: firstError?.stack,
    };
  };

  const bindConsole = (method, level) => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const { message, stack } = toPayload(args);
      logger.log({ level, message, stack });

      if (process.env.NODE_ENV === "test") {
        original(...args);
      }
    };
  };

  bindConsole("log", "info");
  bindConsole("info", "info");
  bindConsole("warn", "warn");
  bindConsole("error", "error");
  bindConsole("debug", "debug");
}

module.exports = {
  logger,
  requestContextMiddleware,
  requestLoggingMiddleware,
  installConsoleInterceptors,
  setRequestContext,
  LOG_TIMEZONE,
};
