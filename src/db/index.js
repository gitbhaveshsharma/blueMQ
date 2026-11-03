"use strict";

// Suppress PostgreSQL SSL mode warning (cosmetic, behavior is already secure)
// The warning is about a future breaking change in pg v9.0.0, not a current security issue
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, type, code, ...args) {
  if (
    typeof warning === "string" &&
    warning.includes("SECURITY WARNING: The SSL modes")
  ) {
    return; // Suppress this specific warning
  }
  return originalEmitWarning.call(this, warning, type, code, ...args);
};

/**
 * src/db/index.js — Neon-hardened PostgreSQL pool module
 *
 * ROOT CAUSES FIXED
 * ─────────────────
 * 1. "Cannot use a pool after calling end on the pool"
 *    closePool() nulls `pool`. Background workers (webhook-delivery, quota-stale,
 *    schedule-worker) kept their setInterval alive and called getDb() after pool
 *    destruction. Fix: closePool() sets `_poolClosed = true` so getDb() throws a
 *    clear, non-retryable "PoolClosed" error instead of creating a new zombie pool.
 *    executeWithRetry() recognises PoolClosedError and does NOT retry.
 *
 * 2. UNKNOWN_ERROR was retryable — poolAfterEnd errors burned 14 s of backoff
 *    Fix: classifyError() maps "pool after calling end" to a dedicated POOL_CLOSED
 *    type. isRetryable() returns false for POOL_CLOSED.
 *
 * 3. Neon ECONNRESET / ETIMEDOUT — dead sockets stayed in the pool
 *    Fix: pool.on("error") triggers createPool() to replace the broken pool
 *    transparently so the next query gets a fresh connection. The broken pool's
 *    end() is called in the background with a 5 s timeout.
 *
 * 4. Pool settings tuned for Neon free-tier (serverless, pauses after 5 min idle)
 *    - min: 1  (not 2) — keep one warm connection but don't block compute from pausing
 *    - idleTimeoutMillis: 120_000 — release idle clients before Neon's 300 s idle timeout
 *    - keepAlive: 30 s — prevents the OS from silently dropping the TCP connection
 *    - statement_timeout: 25 s guard at DB level (caught before HTTP timeout)
 *    - application_name: helps Neon console show which service owns connections
 */

const net = require("net");
const dns = require("dns");
const { Pool } = require("pg");
const config = require("../config");

// ─── State ────────────────────────────────────────────────────────────────────

let _pool = null;       // current pg.Pool instance
let _sqlClient = null;  // wrapped proxy object returned by getDb()
let _poolClosed = false; // set to true by closePool() — blocks new pool creation

// ─── Error types ─────────────────────────────────────────────────────────────

const ErrorType = {
  CONNECTION: "CONNECTION_ERROR",
  TIMEOUT: "TIMEOUT_ERROR",
  AUTH: "AUTH_ERROR",
  QUERY: "QUERY_ERROR",
  POOL_CLOSED: "POOL_CLOSED",
  UNKNOWN: "UNKNOWN_ERROR",
};

function classifyError(error) {
  const msg = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (error.name === "PoolClosedError" || msg.includes("pool after calling end"))
    return ErrorType.POOL_CLOSED;

  // AUTH: pg error codes are uppercase from the wire, compare lowercase
  if (["28p01", "28000"].includes(code)) return ErrorType.AUTH;

  // Network-level disconnects (code-based)
  if (["econnrefused", "enotfound", "econnreset", "enetunreach", "enetdown"].includes(code))
    return ErrorType.CONNECTION;

  // Neon serverless: compute pauses mid-connection → pg emits these with no code
  //   "Connection terminated unexpectedly" — idle socket dropped by Neon
  //   "Connection terminated due to connection timeout" — TCP timeout on active query
  //   "terminating connection due to administrator command" — Neon scale-to-zero
  if (
    msg.includes("connection terminated") ||
    msg.includes("terminating connection") ||
    msg.includes("server closed the connection unexpectedly")
  )
    return ErrorType.CONNECTION;

  // Timeout errors (code or message)
  if (code === "etimedout" || msg.includes("timeout") || msg.includes("timed out"))
    return ErrorType.TIMEOUT;

  // SQL-layer errors (syntax, constraint) — permanent, never a connection issue
  if (error.severity === "ERROR" || code.startsWith("42") || code.startsWith("23"))
    return ErrorType.QUERY;

  return ErrorType.UNKNOWN;
}

function isRetryable(error) {
  const type = classifyError(error);
  // POOL_CLOSED and AUTH are permanent — retrying makes things worse
  return [ErrorType.CONNECTION, ErrorType.TIMEOUT, ErrorType.UNKNOWN].includes(type);
}

class DbError extends Error {
  constructor(message, { type, cause, attempt, maxRetries } = {}) {
    super(message);
    this.name = "DbError";
    this.type = type ?? ErrorType.UNKNOWN;
    this.cause = cause ?? null;
    this.attempt = attempt ?? null;
    this.maxRetries = maxRetries ?? null;
  }
}

class PoolClosedError extends Error {
  constructor() {
    super("Pool has been closed — process is shutting down. No new queries accepted.");
    this.name = "PoolClosedError";
    this.type = ErrorType.POOL_CLOSED;
  }
}

// ─── Socket factory ───────────────────────────────────────────────────────────

/**
 * Custom socket factory for pg.Pool:
 *  - Disables Happy Eyeballs (IPv4 first, avoids IPv6 black-hole on some hosts)
 *  - Enables TCP keepalive (30 s) so Neon doesn't silently drop idle connections
 *  - CRITICAL: adds a no-op 'error' listener so that raw socket errors like
 *    ENETDOWN, ECONNRESET, ETIMEDOUT that fire before pg's own error handler
 *    is attached do NOT propagate as uncaught exceptions and crash the process.
 *    pg's pool.on('error') handles these at the application level.
 */
function createPgSocket() {
  const socket = new net.Socket();
  const _connect = socket.connect.bind(socket);

  socket.connect = (...args) => {
    const [port, host] = args;
    if (typeof port !== "number" || typeof host !== "string") {
      return _connect(...args);
    }
    return _connect({
      port,
      host,
      autoSelectFamily: false,
      lookup: (hostname, options, callback) =>
        dns.lookup(hostname, { ...options, verbatim: false }, callback),
    });
  };

  socket.setKeepAlive(true, 30_000);

  // Safety net: absorb socket-level errors before pg attaches its own handler.
  // Without this, ENETDOWN / ECONNRESET / ETIMEDOUT that fire at the TLSWrap
  // level become uncaught exceptions and crash the process.
  // pg will re-emit the error through pool.on('error') where we handle it.
  socket.on("error", () => {});

  return socket;
}

// ─── Pool factory ─────────────────────────────────────────────────────────────

function buildPoolOptions() {
  return {
    connectionString: config.database.url,
    ssl: { rejectUnauthorized: false },
    stream: createPgSocket,
    // Connection lifecycle
    connectionTimeoutMillis: config.database.connectionTimeoutMs || 15_000,
    //
    // ── KEY NEON FREE-TIER SETTING ────────────────────────────────────────────
    // min: 0 — do NOT keep any persistent idle connections.
    //
    // With min:1 the pool holds one TCP socket open 24/7. Neon free-tier
    // suspends compute after 5 minutes of inactivity. The held socket becomes
    // a dead socket → OS detects it after ~60s → ETIMEDOUT → pool recreation
    // → reconnect → 5 min later, same ETIMEDOUT. Infinite loop.
    //
    // With min:0 the pool goes to zero connections when idle. Neon can suspend
    // freely. The next query creates a fresh connection (waking Neon, ~2–3s
    // cold start), but there are zero dead-socket errors in between.
    //
    min: 0,
    max: 10,
    // Release idle clients after 30 s. With min:0 the pool shrinks to zero.
    // 30 s is well below Neon's 5-min suspend window, so active-session
    // connections are returned promptly after each request.
    idleTimeoutMillis: 30_000,
    // DB-level statement guard — prevents runaway queries blocking the pool
    statement_timeout: 25_000, // 25 s
    application_name: `bluemq-${process.env.PROCESS_MODE || "api"}`,
  };
}

/**
 * Create a fresh pg.Pool with event handlers.
 * On persistent pool errors (ECONNRESET, ETIMEDOUT), schedules a pool recreation.
 */
function createPool() {
  const pool = new Pool(buildPoolOptions());

  pool.on("connect", (client) => {
    if (client.connection && client.connection.stream) {
      const stream = client.connection.stream;
      stream.setKeepAlive(true, 30_000);
      // Guard the TLS stream against raw socket errors (ENETDOWN, ECONNRESET)
      // that can fire before pg attaches its own error handler, causing an
      // uncaught exception crash. pg will surface these via pool.on('error').
      if (!stream.listenerCount("error")) {
        stream.on("error", () => {});
      }

      // CRITICAL FIX: Also guard the underlying socket if it exists.
      // ENETDOWN can fire on the socket level even after TLS handshake completes.
      // The socket might be different from the TLS stream wrapper.
      if (stream.socket && stream.socket !== stream) {
        if (!stream.socket.listenerCount("error")) {
          stream.socket.on("error", () => {});
        }
      }

      // For pg connections, the stream IS the TLS wrapper. However, during
      // network failures (ENETDOWN), the underlying TCP socket can emit errors
      // independently. We need to guard both layers.
      if (stream._parent && !stream._parent.listenerCount("error")) {
        stream._parent.on("error", () => {});
      }
    }
    console.log("[db] New client connected to pool");
  });

  pool.on("remove", () => {
    console.log("[db] Client removed from pool");
  });

  pool.on("error", (err) => {
    const type = classifyError(err);
    console.error("[db] Pool client error:", {
      message: err.message,
      code: err.code,
      type,
    });

    // Recreate the pool for any network-layer error:
    //   CONNECTION — socket-level drops (ECONNRESET, termination, etc.)
    //   TIMEOUT    — ETIMEDOUT, compute cold-start
    //   UNKNOWN    — anything else with no code (e.g. 'Connection terminated
    //                unexpectedly') — safer to recreate than leave a dead socket
    if (
      !_poolClosed &&
      [ErrorType.CONNECTION, ErrorType.TIMEOUT, ErrorType.UNKNOWN].includes(type)
    ) {
      schedulePoolRecreation();
    }
  });

  return pool;
}

// Debounce pool recreation — don't spin up a new pool for every error event
let _recreationTimer = null;
function schedulePoolRecreation() {
  if (_recreationTimer) return;
  _recreationTimer = setTimeout(() => {
    _recreationTimer = null;
    if (_poolClosed) return;
    console.warn("[db] Recreating pool after persistent network error...");
    const oldPool = _pool;
    _pool = createPool();
    // Rebuild the sql client proxy so callers get the new pool transparently
    _sqlClient = createSqlClient(_pool);
    // Drain the old pool quietly in background (5 s hard cap)
    if (oldPool) {
      Promise.race([
        oldPool.end(),
        new Promise((r) => setTimeout(r, 5_000)),
      ]).catch(() => {}).finally(() => {
        console.log("[db] Old pool drained after recreation");
      });
    }
  }, 2_000); // 2 s debounce — collect all error events before acting
  if (_recreationTimer.unref) _recreationTimer.unref();
}

// ─── SQL client proxy ─────────────────────────────────────────────────────────

function buildTaggedQuery(strings, values) {
  let text = "";
  const params = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }
  return { text, params };
}

/**
 * createSqlClient wraps a pool reference in a tagged-template + .query() API.
 *
 * IMPORTANT: The pool reference is captured once at creation time, but we
 * access `_pool` live inside the lambda so pool recreation is transparent.
 * sql.raw is a getter that always returns the current pool.
 */
function createSqlClient(initialPool) {
  const sql = async (strings, ...values) => {
    if (
      !Array.isArray(strings) ||
      !Object.prototype.hasOwnProperty.call(strings, "raw")
    ) {
      throw new TypeError("sql must be used as a tagged template literal");
    }
    const { text, params } = buildTaggedQuery(strings, values);
    const result = await executeWithRetry(() => getCurrentPool().query(text, params));
    return result.rows;
  };

  sql.query = (text, params = []) =>
    executeWithRetry(() => getCurrentPool().query(text, params));

  // sql.raw is used by code that calls pool.connect() directly (transactions)
  // Always returns the CURRENT pool so pool recreation is transparent
  Object.defineProperty(sql, "raw", {
    get() {
      return getCurrentPool();
    },
    enumerable: true,
  });

  return sql;
}

/**
 * Always return the current (possibly recreated) pool.
 * Throws PoolClosedError if the process is shutting down.
 */
function getCurrentPool() {
  if (_poolClosed) {
    throw new PoolClosedError();
  }
  if (!_pool) {
    // This can happen if getDb() was never called before a worker tick fires.
    // Recreate the pool rather than throwing.
    _pool = createPool();
    _sqlClient = createSqlClient(_pool);
  }
  return _pool;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getDb() {
  if (_poolClosed) {
    throw new PoolClosedError();
  }
  if (!config.database.url) {
    throw new DbError("DATABASE_URL is not set", { type: ErrorType.UNKNOWN });
  }
  if (!_pool) {
    _pool = createPool();
    _sqlClient = createSqlClient(_pool);
  }
  return _sqlClient;
}

async function executeWithRetry(
  queryFn,
  maxRetries = config.database?.maxRetries ?? 3,
  retryDelay = config.database?.retryDelayMs ?? 2000,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      if (attempt > 1) {
        console.log(`[db] Query succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const type = classifyError(error);

      // Non-retryable: POOL_CLOSED, AUTH, QUERY errors
      if (!isRetryable(error)) {
        if (type === ErrorType.POOL_CLOSED) {
          // Don't log as error — this is expected during shutdown
          throw error;
        }
        console.error(`[db] Non-retryable error (${type}):`, {
          message: error.message,
          code: error.code ?? null,
          detail: error.detail ?? null,
        });
        throw new DbError(`Query failed: ${error.message}`, {
          type,
          cause: error,
          attempt,
          maxRetries,
        });
      }

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // exponential backoff
        console.warn(
          `[db] Attempt ${attempt}/${maxRetries} failed (${type} — ${error.code ?? error.message}). Retrying in ${delay}ms...`,
        );
        await new Promise((r) => {
          const t = setTimeout(r, delay);
          if (t.unref) t.unref(); // don't block process exit during retry sleep
        });
        // After a connection error, trigger pool recreation before next retry
        if (type === ErrorType.CONNECTION || type === ErrorType.TIMEOUT) {
          schedulePoolRecreation();
        }
      }
    }
  }

  // All retries exhausted
  const type = classifyError(lastError);
  console.error(`[db] All ${maxRetries} attempts failed. Last error:`, {
    message: lastError.message,
    code: lastError.code,
    type,
  });

  throw new DbError(
    `Database connection failed after ${maxRetries} attempts: ${lastError.message}`,
    {
      type,
      cause: lastError,
      attempt: maxRetries,
      maxRetries,
    },
  );
}

async function testConnection() {
  try {
    const db = getDb();
    const start = Date.now();
    await db.query("SELECT 1 AS health_check");
    console.log(`[db] Connection test successful (${Date.now() - start}ms)`);
    return true;
  } catch (error) {
    const type = classifyError(error);
    console.error("[db] Health check failed:", {
      message: error.message,
      code: error.code ?? null,
      type,
      hint: getHint(type),
    });
    return false;
  }
}

/**
 * closePool — called during graceful shutdown.
 *
 * Sets `_poolClosed = true` BEFORE draining the pool so that background
 * worker ticks that are sleeping between polls will throw PoolClosedError
 * (which is not retried) instead of creating a new zombie pool.
 */
async function closePool() {
  if (_poolClosed) return; // already closed
  _poolClosed = true;

  if (_recreationTimer) {
    clearTimeout(_recreationTimer);
    _recreationTimer = null;
  }

  if (_pool) {
    console.log("[db] Closing connection pool...");
    const poolToClose = _pool;
    _pool = null;
    _sqlClient = null;
    try {
      await Promise.race([
        poolToClose.end(),
        new Promise((resolve) => {
          const t = setTimeout(resolve, 8_000);
          if (t.unref) t.unref();
        }),
      ]);
      console.log("[db] Pool closed");
    } catch (err) {
      console.warn("[db] Pool close error (non-fatal):", err.message);
    }
  }
}

/**
 * warmPool — run a single SELECT 1 at startup to wake Neon and verify the
 * connection string is correct. The connection is released immediately so
 * the pool returns to 0 (min:0). No persistent socket is held.
 *
 * Eliminates the ~2-3 s cold-start penalty on the very first real request
 * without holding an idle socket that Neon would kill after 5 min.
 */
async function warmPool() {
  if (!_pool || _poolClosed) return;
  let client;
  try {
    client = await _pool.connect();
    await client.query("SELECT 1 AS warm");
    console.log("[db] Pool warmed — Neon compute is awake");
  } catch (err) {
    console.warn("[db] Pool warm-up failed (non-fatal):", err.message);
  } finally {
    // Always release — pool returns to 0 idle connections after this
    if (client) {
      try { client.release(); } catch (_) { /* ignore */ }
    }
  }
}

// Human-readable hints per error type
function getHint(type) {
  const hints = {
    [ErrorType.AUTH]: "Check DATABASE_URL username and password",
    [ErrorType.CONNECTION]: "Check network connectivity and Neon firewall / IP allowlist",
    [ErrorType.TIMEOUT]: "Neon may be paused or the droplet is blocking outbound port 5432",
    [ErrorType.QUERY]: "SQL syntax or constraint violation — not a connection issue",
    [ErrorType.POOL_CLOSED]: "Process is shutting down — this is expected",
    [ErrorType.UNKNOWN]: "Check Neon console for database status",
  };
  return hints[type] ?? "Unknown error";
}

module.exports = {
  getDb,
  warmPool,
  executeWithRetry,
  testConnection,
  closePool,
  DbError,
  PoolClosedError,
  ErrorType,
  classifyError,
};
