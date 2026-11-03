"use strict";

/**
 * HTTP request metrics middleware.
 *
 * Uses the OTel Metrics API directly — behaves as a no-op when telemetry is
 * disabled (the API returns a no-op meter if no MeterProvider is registered).
 *
 * ── What we emit ────────────────────────────────────────────────────────────
 *
 *   http.server.requests.total  (Counter)
 *     Attributes: route, method, status_class
 *
 *   http.server.errors.total  (Counter)
 *     Attributes: route, method
 *     Incremented only on 5xx responses.
 *
 * ── What we intentionally DO NOT emit ───────────────────────────────────────
 *
 *   http.server.duration  (Histogram) — already emitted by
 *     @opentelemetry/instrumentation-http + instrumentation-express together
 *     when Express populates req.route. Emitting a duplicate would create
 *     cardinality conflicts in Grafana dashboards.
 *
 * ── Cardinality rules ────────────────────────────────────────────────────────
 *
 *   Allowed label values  : route template, HTTP method, status class
 *   NEVER used as labels  : entity_id, app_id, user_id, IP, raw URL,
 *                           notification_id, or any per-request ID
 *
 *   Per-entity detail goes in span attributes and structured log fields only.
 *
 * ── Placement ────────────────────────────────────────────────────────────────
 *
 *   Registered BEFORE routes inside createExpressApp() so it can attach a
 *   "finish" listener before any route handler runs.
 *   The route label is resolved in the finish callback, at which point
 *   Express has already populated req.route.path. ✅
 *
 *   Health and ready routes are mounted even earlier (before security
 *   middleware), so they never reach this middleware at all. ✅
 */

const { metrics } = require("@opentelemetry/api");

const meter = metrics.getMeter("blueMQ-http", "1.0.0");

const requestCounter = meter.createCounter("http.server.requests.total", {
  description: "Total HTTP requests received",
  unit: "{request}",
});

const errorCounter = meter.createCounter("http.server.errors.total", {
  description: "Total HTTP 5xx error responses",
  unit: "{request}",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map an HTTP status code to a low-cardinality class string.
 * @param {number} status
 * @returns {'2xx'|'3xx'|'4xx'|'5xx'|'unknown'}
 */
function toStatusClass(status) {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "unknown";
}

/**
 * Derive the route template label from a request.
 *
 * Reads req.route.path (set by Express after matching) combined with
 * req.baseUrl (the mount prefix). Falls back to "_unknown" for unmatched
 * requests (e.g. 404s hitting the catch-all handler).
 *
 * Examples:
 *   GET /notifications/abc123/logs
 *     req.baseUrl = "/notifications", req.route.path = "/:userId/logs"
 *     → "/notifications/:userId/logs"
 *
 *   GET /notify (direct mount)
 *     req.baseUrl = "/notify", req.route.path = "/"
 *     → "/notify"
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function toRouteLabel(req) {
  if (req.route && req.route.path) {
    const base = req.baseUrl || "";
    const template = req.route.path === "/" ? "" : req.route.path;
    return (base + template) || "/";
  }
  return "_unknown";
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that attaches a "finish" listener to measure request
 * outcomes. Must be mounted before route handlers (but health/ready are
 * already excluded by being mounted earlier in the chain).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function metricsMiddleware(req, res, next) {
  res.on("finish", () => {
    const status = res.statusCode;
    const route = toRouteLabel(req);
    const method = req.method;
    const statusClass = toStatusClass(status);

    requestCounter.add(1, {
      route,
      method,
      status_class: statusClass,
    });

    if (status >= 500) {
      errorCounter.add(1, { route, method });
    }
  });

  next();
}

module.exports = { metricsMiddleware };
