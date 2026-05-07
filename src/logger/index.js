const { AsyncLocalStorage } = require("async_hooks");
const { randomUUID } = require("crypto");
const util = require("util");
const winston = require("winston");

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

function formatMeta(info) {
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

  const context = contextBits.length ? ` [${contextBits.join(" | ")}]` : "";
  const stack = info.stack ? `\n${info.stack}` : "";

  return `${info.timestamp} ${LOG_TIMEZONE} [${info.level}] [${info.service}]${context} ${info.message}${formatMeta(info)}${stack}`;
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: LOG_SERVICE_NAME },
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    injectRequestContext(),
    normalizeMessage(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ level: true }),
        winston.format.timestamp({ format: getTimezoneTimestamp }),
        consoleLineFormatter,
      ),
    }),
  ],
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
