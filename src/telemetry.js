"use strict";

/**
 * OpenTelemetry bootstrap.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  MUST be the very first require() in every entry point.                │
 * │  In src/index.js:  require('./telemetry')  — line 1, before dotenv.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

require("dotenv").config({ quiet: true });

// Enable OpenTelemetry diagnostics
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
if (process.env.OTEL_LOG_LEVEL === 'debug') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
} else {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
}

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
  if (_shutdownCalled) return;
  _shutdownCalled = true;
  
  // If SDK was never initialized or is null, skip gracefully
  if (!_sdk) {
    return;
  }
  
  try {
    // Verify SDK has shutdown method before calling
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
    // Only log if it's not a "cannot read property" error on undefined SDK
    if (err && err.message && !err.message.includes("Cannot read properties of undefined")) {
      process.stderr.write(
        `[telemetry] Shutdown error (non-fatal): ${err.message}\n`,
      );
    }
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
      ParentBasedSampler,
      TraceIdRatioBasedSampler,
      AlwaysOnSampler,
      AlwaysOffSampler,
    } = require("@opentelemetry/sdk-trace");
    const {
      ConsoleSpanExporter,
    } = require("@opentelemetry/sdk-trace");
    const {
      OTLPTraceExporter,
    } = require("@opentelemetry/exporter-trace-otlp-http");
    const {
      OTLPMetricExporter,
    } = require("@opentelemetry/exporter-metrics-otlp-http");
    const {
      OTLPLogExporter,
    } = require("@opentelemetry/exporter-logs-otlp-http");
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
    const {
      RuntimeNodeInstrumentation,
    } = require("@opentelemetry/instrumentation-runtime-node");

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
    // Note: HTTP exporter requires full path including /v1/traces
    const traceExporter = useConsole
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: `${otelConfig.otlpEndpoint}/v1/traces`,
          ...otlpOpts,
        });
    
    // Log exporter configuration for debugging
    if (!useConsole) {
      process.stderr.write(
        `[telemetry] Trace exporter: HTTP to ${otelConfig.otlpEndpoint}/v1/traces\n`,
      );
    }

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
      new WinstonInstrumentation({
        enabled: true,
        // Disable injection since we manually inject in logger/index.js
        disableLogSending: false,
        disableLogCorrelation: false,
      }),

      // RuntimeNode: collects Node.js runtime metrics (event loop, GC)
      new RuntimeNodeInstrumentation({
        enabled: true,
        // Measure event loop utilization every 5 seconds
        eventLoopUtilizationMeasurementInterval: 5000,
      }),
    ];

    // ── NodeSDK (v2 API) ──────────────────────────────────────────────────
    _sdk = new NodeSDK({
      resource,
      sampler,
      traceExporter,  // Pass exporter directly, let SDK create processor
      metricReader,   // Pass reader directly (SDK expects singular)
      logRecordProcessor: logProcessor,  // v2: singular, not array
      instrumentations,
    });
    
    // Log exporter configuration for debugging
    if (!useConsole) {
      process.stderr.write(
        `[telemetry] Metric exporter: HTTP to ${otelConfig.otlpEndpoint}/v1/metrics (export interval: ${otelConfig.metrics.exportIntervalMillis}ms)\n`,
      );
      process.stderr.write(
        `[telemetry] Log exporter: HTTP to ${otelConfig.otlpEndpoint}/v1/logs (batch delay: ${otelConfig.batch.scheduledDelayMillis}ms)\n`,
      );
    }

    _sdk.start();

    // ── Host Metrics (CPU, Memory, Network, Disk) ─────────────────────────
    // Collect system-level metrics: CPU usage, memory, network I/O, disk I/O
    try {
      const { HostMetrics } = require('@opentelemetry/instrumentation-host-metrics');
      
      const hostMetrics = new HostMetrics({
        name: 'blueMQ-host-metrics',
        meterProvider: _sdk.meterProvider,
      });
      
      hostMetrics.start();
      
      process.stderr.write('[telemetry] Host metrics collection started\n');
    } catch (err) {
      process.stderr.write(
        `[telemetry] Host metrics initialization failed (non-fatal): ${err.message}\n`
      );
    }

    // ── Custom System Metrics (Swap) ──────────────────────────────────────
    // Collect swap/page file metrics (Linux, Windows)
    // NOTE: This is a temporary solution. For production, use Grafana Alloy
    // or node_exporter for better system monitoring.
    try {
      require('./metrics/system');
    } catch (err) {
      process.stderr.write(
        `[telemetry] Custom system metrics initialization failed (non-fatal): ${err.message}\n`
      );
    }

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
