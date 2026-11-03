"use strict";

/**
 * OpenTelemetry bootstrap.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  MUST be the very first require() in every entry point.                │
 * │  In src/index.js:  require('./telemetry')  — line 1, before dotenv.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * What this file does:
 *   1. Loads dotenv (idempotent — safe even if index.js also calls it)
 *   2. Reads otel.config.js (pure config, no SDK)
 *   3. If TELEMETRY_ENABLED=true, initialises the NodeSDK synchronously
 *      and registers instrumentations so they can patch libraries at load time
 *   4. Exports shutdownTelemetry() — called inside closeRedisAndExit()
 *
 * Design constraints (ARM VM, free-tier):
 *   - SDK init is wrapped in try/catch — any failure is logged to stderr and ignored
 *   - Telemetry never crashes or blocks the application
 *   - No SIGTERM/SIGINT handlers registered here (would race with index.js handlers)
 *   - Batch processors use conservative limits (OTEL_BSP_* env vars)
 *
 * Orphan span prevention:
 *   - IORedisInstrumentation: requireParentSpan=true
 *     Prevents 51,840+ orphan spans/day from BullMQ, pub/sub, and polling workers
 *   - PgInstrumentation: requireParentSpan=true
 *     Prevents orphan spans from quota-stale (5 min), webhook-delivery (10 sec),
 *     scheduled-notification poll ticks, and pool keepalives
 *
 * Health/ready exclusion:
 *   - HttpInstrumentation ignores GET /health, /ready, /health/* paths
 *
 * Phase 2 trace propagation hook points (not implemented yet):
 *   - src/queues/enqueue.js   → inject traceparent into job.data before queue.add()
 *   - src/workers/base.worker.js → extract traceparent from job.data, start child span
 *   - src/workers/webhook-delivery.worker.js deliverOne() → span per HTTP attempt
 *   - src/ws/index.js wss.on("connection") → ws.connections.active UpDownCounter
 */

require("dotenv").config({ quiet: true });

const otelConfig = require("./config/otel.config");

// ─── Module-level handle ──────────────────────────────────────────────────────
// Set once by initSdk(), read by shutdownTelemetry().
let _sdk = null;
let _shutdownCalled = false;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Flush all pending telemetry and stop the SDK.
 *
 * Call once, early in the shutdown sequence — before Redis quit and PG pool drain.
 * Idempotent: safe to call multiple times.
 *
 * @param {number} [timeoutMs=5000] — Hard cap on flush time. 5 s fits within
 *   kill_timeout=12000 ms set in ecosystem.config.js, leaving room for
 *   PG pool drain (~1 s) and Redis quit (~500 ms).
 */
async function shutdownTelemetry(timeoutMs = 5000) {
  if (_shutdownCalled || !_sdk) return;
  _shutdownCalled = true;
  try {
    if (typeof _sdk.shutdown !== "function") {
      process.stderr.write("[telemetry] SDK has no shutdown() — skipping flush\n");
      return;
    }
    await Promise.race([
      _sdk.shutdown(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    process.stderr.write("[telemetry] Shutdown complete\n");
  } catch (err) {
    process.stderr.write(
      `[telemetry] Shutdown error (non-fatal): ${err.message}\n`,
    );
  }
}

module.exports = { shutdownTelemetry };

// ─── Bail early when disabled ─────────────────────────────────────────────────
// Use a flag instead of top-level `return` so Babel/Jest transformers
// (which parse modules as ESM and reject bare `return`) don't choke.
const _telemetryEnabled = otelConfig.enabled;

if (!_telemetryEnabled) {
  if (process.env.NODE_ENV !== "test") {
    process.stderr.write(
      "[telemetry] Disabled — set TELEMETRY_ENABLED=true to activate\n",
    );
  }
}

// ─── SDK initialisation ───────────────────────────────────────────────────────
// Only initialise when telemetry is enabled.
if (_telemetryEnabled) {
  initSdk();
}

function initSdk() {
  try {
    // ── Imports (inside the guard so they are never loaded when disabled) ──
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const {
      resourceFromAttributes,
      defaultResource,
    } = require("@opentelemetry/resources");
    const {
      BatchSpanProcessor,
      ConsoleSpanExporter,
      ParentBasedSampler,
      TraceIdRatioBasedSampler,
      AlwaysOnSampler,
      AlwaysOffSampler,
    } = require("@opentelemetry/sdk-trace");
    const {
      OTLPTraceExporter,
    } = require("@opentelemetry/exporter-trace-otlp-proto");
    const {
      OTLPMetricExporter,
    } = require("@opentelemetry/exporter-metrics-otlp-proto");
    const {
      OTLPLogExporter,
    } = require("@opentelemetry/exporter-logs-otlp-proto");
    const {
      PeriodicExportingMetricReader,
      ConsoleMetricExporter,
    } = require("@opentelemetry/sdk-metrics");
    const {
      BatchLogRecordProcessor,
      ConsoleLogRecordExporter,
    } = require("@opentelemetry/sdk-logs");
    const {
      HttpInstrumentation,
    } = require("@opentelemetry/instrumentation-http");
    const {
      ExpressInstrumentation,
    } = require("@opentelemetry/instrumentation-express");
    const {
      IORedisInstrumentation,
    } = require("@opentelemetry/instrumentation-ioredis");
    const {
      PgInstrumentation,
    } = require("@opentelemetry/instrumentation-pg");
    const {
      WinstonInstrumentation,
    } = require("@opentelemetry/instrumentation-winston");

    const useConsole = otelConfig.useConsoleExporters;
    const otlpOpts = { headers: parseOtlpHeaders(otelConfig.otlpHeaders) };

    // ── Resource ──────────────────────────────────────────────────────────
    // Merge auto-detected resource (host, OS, process) with our custom attrs.
    const resource = defaultResource().merge(
      resourceFromAttributes({
        "service.name": otelConfig.serviceName,
        "service.instance.id": otelConfig.serviceInstanceId,
        "deployment.environment": otelConfig.deploymentEnvironment,
      }),
    );

    // ── Trace exporter + batch span processor ─────────────────────────────
    const traceExporter = useConsole
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: `${otelConfig.otlpEndpoint}/v1/traces`,
          ...otlpOpts,
        });

    const spanProcessor = new BatchSpanProcessor(traceExporter, {
      scheduledDelayMillis: otelConfig.batch.scheduledDelayMillis,
      exportTimeoutMillis: otelConfig.batch.exportTimeoutMillis,
      maxExportBatchSize: otelConfig.batch.maxExportBatchSize,
      maxQueueSize: otelConfig.batch.maxQueueSize,
    });

    // ── Metrics reader ────────────────────────────────────────────────────
    const metricExporter = useConsole
      ? new ConsoleMetricExporter()
      : new OTLPMetricExporter({
          url: `${otelConfig.otlpEndpoint}/v1/metrics`,
          ...otlpOpts,
        });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: otelConfig.metrics.exportIntervalMillis,
      exportTimeoutMillis: otelConfig.metrics.exportTimeoutMillis,
    });

    // ── Log record processor ──────────────────────────────────────────────
    const logExporter = useConsole
      ? new ConsoleLogRecordExporter()
      : new OTLPLogExporter({
          url: `${otelConfig.otlpEndpoint}/v1/logs`,
          ...otlpOpts,
        });

    const logProcessor = new BatchLogRecordProcessor(logExporter, {
      scheduledDelayMillis: otelConfig.batch.scheduledDelayMillis,
      exportTimeoutMillis: otelConfig.batch.exportTimeoutMillis,
      maxExportBatchSize: otelConfig.batch.maxExportBatchSize,
      maxQueueSize: otelConfig.batch.maxQueueSize,
    });

    // ── Sampler ───────────────────────────────────────────────────────────
    let sampler;
    switch (otelConfig.sampler) {
      case "always_on":
        sampler = new AlwaysOnSampler();
        break;
      case "always_off":
        sampler = new AlwaysOffSampler();
        break;
      default:
        // parentbased_traceidratio — respects incoming W3C traceparent headers
        sampler = new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(otelConfig.samplerArg),
        });
    }

    // ── Instrumentations ─────────────────────────────────────────────────
    const instrumentations = [
      // HTTP: exclude /health, /ready, /health/* from tracing to avoid noise
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || "";
          return (
            url === "/health" ||
            url === "/ready" ||
            url.startsWith("/health/")
          );
        },
      }),

      // Express: populates http.route attribute on spans and the built-in
      // http.server.duration histogram — do NOT emit a custom duration histogram
      new ExpressInstrumentation(),

      // IORedis: requireParentSpan=true prevents orphan spans from:
      //   - BullMQ queue polling (BRPOP every ~5 s across 6 worker processes)
      //   - Redis pub/sub subscriber (permanent listener in API process)
      //   - Template cache reads (setInterval in quota-stale, webhook-delivery)
      new IORedisInstrumentation({ requireParentSpan: true }),

      // Postgres: requireParentSpan=true prevents orphan spans from:
      //   - webhook-delivery.worker.js setInterval every 10 s (6 processes)
      //   - quota-stale.worker.js setInterval every 5 min (6 processes)
      //   - scheduled-notification.worker.js poll tick (6 processes)
      //   - pool keepalives / warm-up queries
      new PgInstrumentation({ requireParentSpan: true }),

      // Winston: adds trace_id/span_id to log records and ships them to
      // the OTel logs pipeline (LoggerProvider set by NodeSDK above)
      new WinstonInstrumentation({ enabled: true }),
    ];

    // ── NodeSDK (v2 API) ──────────────────────────────────────────────────
    _sdk = new NodeSDK({
      resource,
      sampler,
      spanProcessors: [spanProcessor],
      metricReaders: [metricReader],        // v2: plural array
      logRecordProcessors: [logProcessor],  // v2: plural array
      instrumentations,
    });

    _sdk.start();

    process.stderr.write(
      `[telemetry] Started ` +
        `service=${otelConfig.serviceName} ` +
        `instance=${otelConfig.serviceInstanceId} ` +
        `env=${otelConfig.deploymentEnvironment} ` +
        `exporters=${useConsole ? "console" : "otlp"} ` +
        `sampler=${otelConfig.sampler}(${otelConfig.samplerArg})\n`,
    );
  } catch (err) {
    // Telemetry must never crash the app
    process.stderr.write(
      `[telemetry] Init failed (non-fatal, app continues): ${err.message}\n`,
    );
    _sdk = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse OTEL_EXPORTER_OTLP_HEADERS into a plain object.
 *
 * Supports both standard format ("key1=val1,key2=val2") and
 * Grafana Cloud format ("Authorization=Basic <base64token>").
 * The first "=" in each pair is the key/value delimiter.
 *
 * @param {string} headersStr
 * @returns {Record<string, string>}
 */
function parseOtlpHeaders(headersStr) {
  if (!headersStr || !headersStr.trim()) return {};
  const result = {};
  for (const pair of headersStr.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
  }
  return result;
}
