# BlueMQ OpenTelemetry Observability Architecture & Implementation Guide

## 1. Executive Summary

This document describes the OpenTelemetry-based observability subsystem implemented in BlueMQ (Phase 1). The design delivers production-grade distributed tracing, application metrics, and correlated logging with zero hardcoded endpoints, zero disruption to notification delivery, and protection against resource leaks on resource-constrained VM environments (Ubuntu ARM server, 12 GB RAM, 2 vCPUs, Neon serverless PostgreSQL, Redis, and BullMQ).

---

## 2. High-Level System Architecture

```mermaid
flowchart TD
    subgraph AppProcess["BlueMQ Process (API & Background Workers)"]
        Bootstrap["src/telemetry.js<br/>(Pre-loaded via -r or index.js Line 1)"]
        NodeSDK["@opentelemetry/sdk-node NodeSDK"]
        
        subgraph AutoInstr["Load-Time Auto-Instrumentation"]
            HttpInstr["HttpInstrumentation<br/>(Drops /health, /ready)"]
            ExpInstr["ExpressInstrumentation<br/>(Captures http.route)"]
            RedisInstr["IORedisInstrumentation<br/>(requireParentSpan: true)"]
            PgInstr["PgInstrumentation<br/>(requireParentSpan: true)"]
            WinstonInstr["WinstonInstrumentation"]
        end

        subgraph CoreApp["Application Modules"]
            ExpressApp["Express API Server"]
            HealthRoutes["src/api/routes/health.js<br/>/health (200), /ready (15s cache)"]
            MetricsMw["src/api/middlewares/metrics.js<br/>req/error counters"]
            WinstonLogger["src/logger/index.js<br/>Trace-correlated logs"]
            BullMQ["BullMQ Queues & Workers"]
            PgPool["PostgreSQL (Neon) Pool"]
        end
    end

    subgraph OTLPExport["Export Pipeline (Buffered / Batch)"]
        TraceExp["BatchSpanProcessor<br/>OTLPTraceExporter (HTTP/Proto)"]
        MetricExp["PeriodicExportingMetricReader<br/>OTLPMetricExporter (HTTP/Proto)"]
        LogExp["BatchLogRecordProcessor<br/>OTLPLogExporter (HTTP/Proto)"]
    end

    subgraph ObservabilityBackend["External Observability (e.g. Grafana Cloud / OTel LGTM)"]
        Tempo["Grafana Tempo<br/>(Traces / Waterfalls)"]
        Prom["Prometheus / Mimir<br/>(Metrics / Dashboards)"]
        Loki["Grafana Loki<br/>(Correlated Logs)"]
    end

    Bootstrap --> NodeSDK
    NodeSDK --> AutoInstr
    ExpressApp --> HealthRoutes
    ExpressApp --> MetricsMw
    ExpressApp --> WinstonLogger
    AutoInstr -.->|Wrap at require()| ExpressApp
    AutoInstr -.->|Wrap at require()| RedisInstr
    AutoInstr -.->|Wrap at require()| PgInstr
    AutoInstr -.->|Wrap at require()| WinstonLogger

    NodeSDK --> TraceExp
    NodeSDK --> MetricExp
    NodeSDK --> LogExp

    TraceExp --> Tempo
    MetricExp --> Prom
    LogExp --> Loki
    Loki -.->|trace_id 1-click drilldown| Tempo
```

---

## 3. Detailed File Structure & Responsibilities

The table below lists every file involved in the observability and health architecture, its role, and key implementation mechanisms:

| File Path | Type | Responsibility & Key Implementation |
| :--- | :--- | :--- |
| `src/telemetry.js` | Core | **OpenTelemetry Bootstrap Module**.<br>• Loaded at line 1 of every entry point before any other imports.<br>• Initializes `@opentelemetry/sdk-node` NodeSDK with trace, metric, and log processors.<br>• Configures parent-based sampling (`parentbased_traceidratio`).<br>• Enforces `requireParentSpan: true` for Redis and Postgres to stop orphan span flooding.<br>• Configures `ignoreIncomingRequestHook` to eliminate synthetic probe spans.<br>• Exports `shutdownTelemetry(timeoutMs)` for graceful shutdown. |
| `src/config/otel.config.js` | Config | **Pure Configuration Module (No SDK dependencies)**.<br>• Parses environment variables: `TELEMETRY_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `TELEMETRY_DEBUG_CONSOLE`.<br>• Validates sampling ratios (clamps between 0.0 and 1.0).<br>• Provides safe, conservative defaults for batch queues and export delays. |
| `src/logger/index.js` | Logging | **Winston Logger with Trace Correlation**.<br>• Custom format module reads `@opentelemetry/api` active span context.<br>• Injects `trace_id`, `span_id`, and `trace_flags` into every JSON log record.<br>• Allows Winston logs in Grafana Loki to link directly to traces in Tempo with zero manual tagging. |
| `src/api/middlewares/metrics.js` | Middleware | **HTTP Request & Error Metrics Counter**.<br>• Attaches a listener to `res.on("finish")`.<br>• Increments `http.server.request.count` labeled with `http.request.method`, `http.response.status_code`, and `http.route`.<br>• Safely formats route labels using `req.baseUrl + req.route.path` with fallback to `_unknown`.<br>• Increments `http.server.error.count` on status >= 500.<br>• Defers duration measurement to `@opentelemetry/instrumentation-http` to avoid collision with standard metrics. |
| `src/api/routes/health.js` | API Route | **Operational Probes (Liveness & Readiness)**.<br>• `GET /health`: Liveness probe — instant 200, zero DB/Redis overhead.<br>• `GET /health/detail`: Operational dashboard stats — BullMQ queue counts and provider registry, auth-gated with `x-api-key`.<br>• `GET /ready`: Readiness probe — checks Redis PING and Postgres SELECT 1 with 15-second in-memory caching and timeout guards with timer unref to prevent open handles. |
| `src/index.js` | Entry Point | **Main Application Server**.<br>• Calls `require("./telemetry")` at line 1.<br>• Mounts `/health` and `/ready` in `createExpressApp()` *before* security and rate-limiting middleware.<br>• Calls `shutdownTelemetry(5000)` in `closeRedisAndExit()` before pool and Redis teardown. |
| `ecosystem.config.js` | PM2 Config | **Process Manager Configuration**.<br>• Preloads telemetry in all PM2 instances: `node_args: "-r ./src/telemetry.js"`.<br>• Extends shutdown budget: `kill_timeout: 12000` (12 seconds) ensuring 5s telemetry flush has comfortable headroom. |
| `nginx/conf.d/bluemq.conf` | Reverse Proxy | **Nginx Edge Routing**.<br>• Configures `/health` and `/ready` to bypass caching, forward client IP headers, and route directly to Node.js backend. |
| `frontend/src/services/api.js` | Frontend | **Dashboard Health Widget**.<br>• Updated to hit `GET /health/detail` with `x-api-key` so the dashboard displays BullMQ queue depth and active provider status without exposing them publicly. |
| `.env.example` | Env Docs | **Environment Documentation**.<br>• Full documentation and default values for all OpenTelemetry and Telemetry config variables. |

---

## 4. End-to-End Request & Telemetry Lifecycle

### Step 1: Bootstrapping & Instrumentation
1. The process starts (`node src/index.js` or `node -r ./src/telemetry.js src/index.js`).
2. `src/telemetry.js` executes first. If `TELEMETRY_ENABLED=true`:
   - It instantiates `NodeSDK` and registers `HttpInstrumentation`, `ExpressInstrumentation`, `IORedisInstrumentation`, `PgInstrumentation`, and `WinstonInstrumentation`.
   - NodeSDK wraps core libraries (`http.createServer`, `express`, `ioredis`, `pg`, `winston`) in memory before application code imports them.
3. If `TELEMETRY_ENABLED=false` (or not set), `initSdk()` is bypassed, and telemetry functions as an ultra-lightweight no-op.

### Step 2: Incoming HTTP Request
1. Request arrives (e.g. `POST /notify`).
2. `HttpInstrumentation` automatically starts a server span with standard W3C baggage and trace headers (`traceparent`, `tracestate`).
3. Express routes the request through middleware:
   - `requestContextMiddleware`: Generates or propagates `req.requestId`.
   - `ipAccessControlMiddleware` & `rateLimiter`: Validates tenant security.
   - `metricsMiddleware`: Attaches `res.on("finish")` hook.
4. If an internal database query is run (`sql.query(...)`), `PgInstrumentation` detects the active parent HTTP span and records a child span for the query (`pg.query`).
5. If a message is published or queried in Redis (`client.get(...)`), `IORedisInstrumentation` records a child span (`redis.command`).

### Step 3: Winston Log Generation
1. Application logs an event: `logger.info("Notification enqueued", { notificationId })`.
2. The custom Winston format reads `@opentelemetry/api.trace.getActiveSpan()`.
3. It extracts:
   - `trace_id` (32 hex characters)
   - `span_id` (16 hex characters)
   - `trace_flags` (e.g., `01` for sampled)
4. The output JSON log contains these identifiers alongside the message and timestamp.
5. In Grafana, viewing this log record in Loki displays a clickable badge: **"View Trace"**, which immediately opens the full waterfall span in Grafana Tempo.

### Step 4: Request Completion & Metric Emission
1. `res.send()` sends the response to the client.
2. `res.on("finish")` fires:
   - Express instrumentation completes the root HTTP span and computes `http.server.duration`.
   - `metricsMiddleware` increments `http.server.request.count` labeled with method, status, and resolved route (`/notify`).
   - If `res.statusCode >= 500`, it increments `http.server.error.count`.

### Step 5: Background Batch Export
1. `BatchSpanProcessor` queues spans in memory and flushes them in batches every `OTEL_BSP_SCHEDULE_DELAY_MILLIS` (default: 5,000 ms) via HTTP POST (`/v1/traces`) with protobuf payloads to `OTEL_EXPORTER_OTLP_ENDPOINT`.
2. `PeriodicExportingMetricReader` exports aggregated metrics every `OTEL_METRICS_EXPORT_INTERVAL_MS` (default: 60,000 ms) via `/v1/metrics`.
3. `BatchLogRecordProcessor` exports logs via `/v1/logs`.

---

## 5. Critical Stability & Resource Optimizations

### 5.1 Preventing Orphan Span Explosions
In high-throughput BullMQ systems, background workers run continuous polling loops (`BRPOP` every ~5 seconds, Redis pub/sub listeners, quota-stale sweeps, webhook delivery retries, scheduled notification ticks).

- **The Danger**: Without guards, each polling tick creates standalone root spans. Across 6 PM2 worker processes, this generates over **51,840 orphan spans per day**, wasting bandwidth and storage.
- **The Solution**: Both Redis and Postgres instrumentations are configured with:
  ```javascript
  new IORedisInstrumentation({ requireParentSpan: true })
  new PgInstrumentation({ requireParentSpan: true })
  ```
  Spans are only created when there is an active parent request span. Background polling loops execute completely silent of telemetry traces.

### 5.2 Serverless PostgreSQL (Neon) Cold-Start Protection
Neon PostgreSQL on free/serverless tiers suspends compute after 5 minutes of inactivity:
- Frequent readiness polling from orchestrators or uptime checkers could prevent compute suspension, burning unexpected compute hours.
- **The Solution**: `src/api/routes/health.js` caches `GET /ready` results in-memory for 15 seconds (`READY_CACHE_TTL_MS = 15000`).
- Individual checks use `withTimeout` with `.unref()` so active timers do not prevent Node.js from exiting cleanly during tests or process termination.

### 5.3 Liveness Security Bypass
The liveness endpoint `GET /health`:
- Mounted **before** `ipAccessControlMiddleware`, `requestValidationMiddleware`, and `globalRateLimiter`.
- Returns `status: "ok"` and `uptime` without touching Redis or Postgres.
- Excluded from tracing (`ignoreIncomingRequestHook`).
- Guarantees uptime probes are never blocked, rate-limited, or delayed even under DDoS mitigation.

---

## 6. Zero-Downtime Graceful Shutdown Sequence

During server maintenance or deployment (`pm2 reload ecosystem.config.js`), the processes execute an orderly shutdown:

```
[SIGTERM / SIGINT Received]
          │
          ▼
1. Flush OpenTelemetry (5,000 ms budget)
   └── shutdownTelemetry() pushes remaining buffered spans, metrics, and logs over OTLP
          │
          ▼
2. Drain Postgres Pool (~1,000 ms)
   └── closePool() waits for active in-flight queries to finish and disconnects sockets
          │
          ▼
3. Close Redis Connections (~500 ms)
   └── closeRedis() calls .quit() on BullMQ queue, publisher, and subscriber clients
          │
          ▼
4. process.exit(0)
   └── Entire sequence finishes in ~6.5 s, safely below PM2 kill_timeout (12,000 ms)
```

---

## 7. Configuration Reference

All settings are configured via environment variables in `.env`:

```bash
# ── Observability Master Switch ──
TELEMETRY_ENABLED=true

# ── Service Identity ──
OTEL_SERVICE_NAME=bluemq-api
OTEL_SERVICE_INSTANCE_ID=pm2-api-0
DEPLOYMENT_ENVIRONMENT=production

# ── OTLP Destination (e.g. Grafana Cloud OTLP Gateway) ──
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64_instance_id_and_token>

# ── Sampling (10% in production, 100% in staging) ──
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1

# ── Local Console Debug Mode (Optional) ──
TELEMETRY_DEBUG_CONSOLE=false

# ── Memory & Export Batch Tuning ──
OTEL_BSP_SCHEDULE_DELAY_MILLIS=5000
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_METRICS_EXPORT_INTERVAL_MS=60000
```

---

## 8. Testing & Verification

Automated test suites validate all components:

### Run OpenTelemetry and Health Tests
```bash
npx jest tests/health.routes.test.js tests/otel.config.test.js tests/otel.logger.test.js tests/metrics.middleware.test.js
```

### Test Coverage Summary
- `tests/health.routes.test.js` (11 tests):
  - Liveness probe returns 200 without dependencies
  - Auth-gated `/health/detail` returns queue and provider stats
  - Readiness probe verifies Redis & Postgres health with timeout protection
- `tests/otel.config.test.js` (15 tests):
  - Validates environment variable parsing, fallback defaults, and header parsing
- `tests/otel.logger.test.js` (20 tests):
  - Validates Winston log formatting and injection of `trace_id`, `span_id`, and `trace_flags`
- `tests/metrics.middleware.test.js` (11 tests):
  - Validates request counters, error tracking (5xx), and dynamic route extraction
