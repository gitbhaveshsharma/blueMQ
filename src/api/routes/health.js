"use strict";

const { Router } = require("express");

/**
 * Health and readiness endpoints.
 *
 * ── Exported routers ──────────────────────────────────────────────────────────
 *
 *   healthRouter  (mounted at /health in index.js, BEFORE security middleware)
 *
 *     GET /health
 *       Liveness probe — cheap, no dependency calls, no auth required.
 *       Safe to hit from Docker healthcheck, nginx, and external uptime monitors
 *       at any frequency. Returns 200 immediately.
 *
 *     GET /health/detail
 *       Provider list + BullMQ queue stats. Requires x-api-key auth.
 *       This is what the frontend dashboard health widget should call.
 *       (Old GET /health behaviour, now gated behind auth.)
 *
 *   readyRouter  (mounted at /ready in index.js, BEFORE security middleware)
 *
 *     GET /ready
 *       Readiness probe — checks Redis PING + Postgres SELECT 1.
 *       Returns 200 { healthy: true } or 503 { healthy: false, checks: {...} }.
 *       Result is cached for READY_CACHE_TTL_MS (15 s) so that continuous
 *       polling does NOT keep Neon awake and burning compute hours.
 *       Use for deploy readiness gates — NOT for external uptime probes
 *       (point those at /health instead).
 *
 * ── Security bypass ───────────────────────────────────────────────────────────
 *
 *   Both routers are mounted in createExpressApp() BEFORE the security
 *   middleware stack (ipAccessControlMiddleware, requestValidationMiddleware,
 *   globalRateLimiter, etc.). This ensures that:
 *     - A banned IP can still reach the liveness probe
 *     - Health checks are never rate-limited
 *     - Neither endpoint is traced (excluded in HttpInstrumentation config)
 *     - Neither endpoint appears in requestLoggingMiddleware output
 */

const { authMiddleware } = require("../middlewares/auth");

// ─── Liveness (/health, /health/detail) ──────────────────────────────────────

const healthRouter = Router();

/**
 * GET /health — liveness.
 * Cheap: no database, no Redis, no external calls.
 * Returns 200 immediately so Docker / nginx / uptime monitors see the process alive.
 */
healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/detail — operational stats (auth required).
 * Returns provider registration status + BullMQ queue job counts.
 * This is the data the frontend dashboard health widget needs.
 * Requires x-api-key so queue internals are not publicly visible.
 */
healthRouter.get("/detail", authMiddleware, async (_req, res) => {
  try {
    // Lazy-require to avoid circular dependency at module load time
    const { registry } = require("../../providers/registry");
    const { queues } = require("../../queues");

    const queueStats = {};
    for (const [channel, queue] of queues) {
      queueStats[channel] = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
      );
    }

    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: registry.toJSON(),
      queues: queueStats,
    });
  } catch (err) {
    console.error("[health] Detail error:", err);
    return res.status(500).json({ status: "error", error: err.message });
  }
});

// ─── Readiness (/ready) ───────────────────────────────────────────────────────

const readyRouter = Router();

/**
 * Cache TTL for readiness results (milliseconds).
 * 15 seconds: short enough to catch real failures quickly, long enough to
 * prevent continuous polling from keeping Neon compute awake (which pauses
 * after 5 minutes of inactivity on the free tier).
 */
const READY_CACHE_TTL_MS = 15_000;

/** Hard timeout for each individual dependency check */
const READY_CHECK_TIMEOUT_MS = 2_000;

/** In-process cache — intentionally NOT Redis (circular dependency) */
let _readyCache = null;
let _readyCachedAt = 0;

function withTimeout(promise, timeoutMs, errorMsg) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Check Redis by issuing a PING command.
 * Uses the shared BullMQ connection (already established — avoids cold connects).
 */
async function checkRedis() {
  // Lazy-require to avoid circular deps at module load time
  const { getRedisConnection } = require("../../queues/connection");
  const client = getRedisConnection();

  const result = await withTimeout(
    client.ping(),
    READY_CHECK_TIMEOUT_MS,
    "Redis PING timeout",
  );

  if (result !== "PONG") {
    throw new Error(`Unexpected Redis PING response: ${String(result)}`);
  }
}

/**
 * Check Postgres by issuing a direct query on a raw pool client.
 * Bypasses executeWithRetry intentionally — /ready should be fast and never
 * retry (the retry storm was causing the 14s delay seen in logs).
 */
async function checkPostgres() {
  // getDb() lazy-initializes the pool; we then use the raw pool for
  // a one-shot connection so we can set a hard query timeout.
  const { getDb } = require("../../db");
  const sql = getDb();
  const pool = sql.raw; // pool getter — always current pool after recreation

  const client = await withTimeout(
    pool.connect(),
    READY_CHECK_TIMEOUT_MS,
    "Postgres connection timeout",
  );
  try {
    await withTimeout(
      client.query("SELECT 1 AS health_check"),
      READY_CHECK_TIMEOUT_MS,
      "Postgres query timeout",
    );
  } finally {
    client.release();
  }
}

/**
 * Run both readiness checks, cache the result, and return it.
 * Both checks run concurrently via Promise.allSettled.
 */
async function runReadinessChecks() {
  const now = Date.now();

  if (_readyCache && now - _readyCachedAt < READY_CACHE_TTL_MS) {
    return _readyCache;
  }

  const checks = { redis: "ok", postgres: "ok" };
  const errors = {};

  await Promise.allSettled([
    checkRedis().catch((err) => {
      checks.redis = "fail";
      errors.redis = err.message;
    }),
    checkPostgres().catch((err) => {
      checks.postgres = "fail";
      errors.postgres = err.message;
    }),
  ]);

  const healthy = checks.redis === "ok" && checks.postgres === "ok";

  const result = {
    healthy,
    checks,
    ...(Object.keys(errors).length > 0 && { errors }),
    timestamp: new Date().toISOString(),
    cached: false,
  };

  _readyCache = { ...result, cached: true };
  _readyCachedAt = now;

  return result;
}

/**
 * GET /ready — readiness.
 * Returns 200 when both Redis and Postgres are healthy.
 * Returns 503 when either dependency fails.
 * Result is cached for 15 seconds.
 *
 * External uptime monitors should use GET /health (liveness) instead.
 * Use /ready for: deploy readiness gates, orchestrator readiness checks.
 */
readyRouter.get("/", async (_req, res) => {
  try {
    const result = await runReadinessChecks();
    return res.status(result.healthy ? 200 : 503).json(result);
  } catch (err) {
    console.error("[ready] Unexpected error:", err);
    return res.status(503).json({
      healthy: false,
      checks: { redis: "unknown", postgres: "unknown" },
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = { healthRouter, readyRouter };
