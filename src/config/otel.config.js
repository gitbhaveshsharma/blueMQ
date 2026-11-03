"use strict";

/**
 * OpenTelemetry configuration.
 *
 * Pure value module — no SDK imports, no side effects.
 * All configuration is derived from environment variables.
 * Required by src/telemetry.js before anything else loads.
 *
 * Environment variables (set these in .env or PM2 env block):
 *
 *   TELEMETRY_ENABLED             true | false (default: false)
 *   TELEMETRY_DEBUG_CONSOLE       true | false — swap OTLP for console exporters
 *
 *   OTEL_SERVICE_NAME             overrides derived name (optional)
 *   OTEL_EXPORTER_OTLP_ENDPOINT   e.g. https://otlp-gateway-prod-us-east-0.grafana.net
 *   OTEL_EXPORTER_OTLP_HEADERS    "Authorization=Basic <token>" (comma-separated k=v)
 *   OTEL_EXPORTER_OTLP_PROTOCOL   ignored — we always use protobuf (http/protobuf)
 *
 *   OTEL_TRACES_SAMPLER           parentbased_traceidratio (default) | always_on | always_off
 *   OTEL_TRACES_SAMPLER_ARG       sampling ratio 0.0–1.0 (default: 0.1)
 *
 *   DEPLOYMENT_ENV                production | staging | development (default: NODE_ENV)
 *
 *   Batch processor tuning (optional, ARM-friendly defaults):
 *   OTEL_BSP_SCHEDULE_DELAY       ms between export attempts (default: 500)
 *   OTEL_BSP_EXPORT_TIMEOUT       ms before export times out (default: 4000)
 *   OTEL_BSP_MAX_EXPORT_BATCH_SIZE max spans per export (default: 256)
 *   OTEL_BSP_MAX_QUEUE_SIZE       max queued spans before dropping (default: 512)
 *   OTEL_METRIC_EXPORT_INTERVAL_MS ms between metric exports (default: 60000)
 */

require("dotenv").config({ quiet: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBool(val, defaultVal) {
  if (val === undefined || val === null || val === "") return defaultVal;
  return String(val).trim().toLowerCase() === "true";
}

function parseInt10(val, defaultVal) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

function parseFloat10(val, defaultVal) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : defaultVal;
}

// ─── Service name derivation ──────────────────────────────────────────────────

/**
 * Derive a distinct service.name for each PM2 process.
 *
 * Priority:
 *   1. OTEL_SERVICE_NAME env var (explicit override)
 *   2. PROCESS_MODE=api         → "blueMQ-api"
 *   3. PROCESS_MODE=worker      → "blueMQ-worker-<channel>"
 *   4. Fallback                 → "blueMQ"
 *
 * This ensures every one of the 7 PM2 processes gets a distinct name
 * (blueMQ-api, blueMQ-worker-email, blueMQ-worker-push, etc.).
 */
function deriveServiceName() {
  const explicit = (process.env.OTEL_SERVICE_NAME || "").trim();
  if (explicit) return explicit;

  const mode = (process.env.PROCESS_MODE || "all").toLowerCase().trim();

  if (mode === "api") return "blueMQ-api";

  if (mode === "worker") {
    const channels = (process.env.WORKER_CHANNELS || "").trim();
    const first = channels.split(",")[0].trim();
    return first ? `blueMQ-worker-${first}` : "blueMQ-worker";
  }

  // PROCESS_MODE=all (combined mode, rare in production)
  return "blueMQ";
}

/**
 * Build a unique instance identifier that includes PM2's instance id and PID.
 * PM2 sets PM2_APP_INSTANCE_ID (0, 1, 2, …) in fork mode.
 */
function deriveInstanceId() {
  const pm2Id =
    process.env.PM2_APP_INSTANCE_ID ?? process.env.APP_INSTANCE_ID ?? null;
  return pm2Id !== null ? `${pm2Id}-${process.pid}` : String(process.pid);
}

// ─── Computed values ──────────────────────────────────────────────────────────

const enabled = parseBool(process.env.TELEMETRY_ENABLED, false);
const debugConsole = parseBool(process.env.TELEMETRY_DEBUG_CONSOLE, false);
const otlpEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();

/**
 * Use console exporters when:
 *   - TELEMETRY_DEBUG_CONSOLE=true (explicit debug request), OR
 *   - TELEMETRY_ENABLED=true but no OTLP endpoint is configured
 *     (auto-fallback so a `TELEMETRY_ENABLED=true` dev run always produces output)
 *
 * Note: when TELEMETRY_ENABLED=false, this field is irrelevant (SDK never starts).
 */
const useConsoleExporters = debugConsole || (enabled && !otlpEndpoint);

const samplerArg = parseFloat10(process.env.OTEL_TRACES_SAMPLER_ARG, 0.1);

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  enabled,
  useConsoleExporters,

  serviceName: deriveServiceName(),
  serviceInstanceId: deriveInstanceId(),
  deploymentEnvironment:
    (process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || "production").trim(),

  otlpEndpoint,
  otlpHeaders: (process.env.OTEL_EXPORTER_OTLP_HEADERS || "").trim(),

  sampler: (process.env.OTEL_TRACES_SAMPLER || "parentbased_traceidratio").trim(),
  samplerArg: Math.min(1, Math.max(0, samplerArg)), // clamp 0–1

  batch: {
    /** Milliseconds between batch processor export attempts */
    scheduledDelayMillis: parseInt10(process.env.OTEL_BSP_SCHEDULE_DELAY, 500),
    /** Milliseconds before an individual export call times out */
    exportTimeoutMillis: parseInt10(process.env.OTEL_BSP_EXPORT_TIMEOUT, 4000),
    /** Maximum number of spans sent in a single export batch */
    maxExportBatchSize: parseInt10(
      process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE,
      256,
    ),
    /** Maximum queue size before spans are dropped */
    maxQueueSize: parseInt10(process.env.OTEL_BSP_MAX_QUEUE_SIZE, 512),
  },

  metrics: {
    /** Milliseconds between metric export cycles */
    exportIntervalMillis: parseInt10(
      process.env.OTEL_METRIC_EXPORT_INTERVAL_MS,
      60_000,
    ),
    exportTimeoutMillis: 15_000,
  },
};
