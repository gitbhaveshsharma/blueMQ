# Grafana Cloud Monitoring Guide

Complete guide for monitoring BlueMQ using Grafana Cloud with OpenTelemetry.

---

## 📊 Dashboard Overview

**Dashboard:** BlueMQ API — Node.js OpenTelemetry Overview  
**URL:** https://slimhoneydew2834.grafana.net/dashboards

### What We Monitor

**Traces:** Request flows and distributed tracing (Tempo)  
**Metrics:** Performance, errors, system resources (Prometheus)  
**Logs:** Application logs with trace correlation (Loki)

---

## 🎯 Quick Health Check

### Top Row: Key Metrics

1. **Success Rate** - % of successful requests (target: > 99%)
2. **Request Rate** - Requests per second
3. **Error Rate** - 5xx errors per second (target: < 0.1)
4. **Error Ratio** - % of failed requests (target: < 1%)
5. **p95 Latency** - 95th percentile response time (target: < 500ms)
6. **Active Instances** - Number of running PM2 processes

**Health Status:**
- 🟢 Green = Normal operations
- 🟡 Yellow = Warning (investigate)
- 🔴 Red = Critical (immediate action required)

---

## 📈 System Resources Row

### Server Metrics

**Server CPU %** - Overall CPU utilization
- Green: 0-70%
- Yellow: 70-90%
- Red: > 90%

**Server Memory %** - RAM utilization
- Green: 0-70%
- Yellow: 70-85%
- Red: > 85%

**Swap Usage** - Swap memory used (should be 0)
- Green: 0 GB
- Yellow/Red: > 0 GB (memory pressure!)

### Process Metrics (Per PM2 Instance)

**Process Memory (RSS)** - Memory used by Node.js process
- Typical: 200-800 MB per process
- Alert if growing continuously (memory leak)

**V8 Heap** - JavaScript heap memory
- Shows used vs total heap
- Watch for: heap growing linearly (memory leak)

**Process CPU %** - CPU usage per process
- Normal: 10-70% during traffic
- Alert: sustained > 90%

**Event Loop Lag** - Node.js event loop delay (p99)
- Green: < 10ms
- Yellow: 10-50ms
- Red: > 100ms (blocking code)

---

## 🔍 Traffic & Performance

### Request Analysis

**Traffic by Endpoint** - Requests per second by route
- Identify hotspots and traffic patterns
- Click legend to hide/show specific routes

**Top 10 Endpoints** - Most called routes
- Prioritize optimization for top routes
- Use for capacity planning

**Request Volume by Status** - Total requests by HTTP status
- Green bars: 2xx (success)
- Orange bars: 4xx (client errors)
- Red bars: 5xx (server errors)

### Latency Monitoring

**Latency Percentiles (p50/p95/p99)**
- p50: Median response time
- p95: 95% of requests complete within this time
- p99: Slowest 1% of requests

**Targets:**
- p50: < 100ms
- p95: < 500ms
- p99: < 1000ms

Higher p99 = some requests are very slow

---

## 🔴 Errors & Troubleshooting

### Error Timeline
Red line showing 5xx errors over time.

**Common causes:**
- Deployment issues
- Database connectivity
- External API failures
- Memory/CPU exhaustion

### Recent Error Logs
Filtered view of error/fatal/critical logs.

**How to use:**
1. Click log line to expand
2. Look for stack traces
3. Check trace_id to see full request flow
4. Correlate with error timeline

### Failed Request Traces
Table of requests that returned 5xx errors.

**Columns:**
- Trace ID: Click to open in Tempo
- Service: Which service failed
- Route: Which endpoint
- HTTP Status: Error code
- Duration: How long it took

**Investigation steps:**
1. Click trace ID
2. View full distributed trace
3. See which span failed
4. Check span attributes for error details

---

## 📊 Using the Dashboard

### Time Range Selection

**Common ranges:**
- Last 5 minutes: Live monitoring
- Last 1 hour: Recent issues
- Last 6 hours: Trend analysis
- Last 24 hours: Daily patterns

**Custom range:**
- Click time picker (top right)
- Select specific date/time range

### Filters (Variables)

**Instance Filter** - Select specific PM2 process or "All"
- `blueMQ-api`: API server process
- `blueMQ-worker-*`: Background worker processes

**Future filters:**
- Route: Focus on specific endpoint
- Status: Filter by 2xx/4xx/5xx
- Environment: dev/staging/production

### Auto-Refresh

Set refresh rate for live monitoring:
- 5s: Real-time (during incidents)
- 30s: Active monitoring
- 1m: Normal monitoring
- Off: Historical analysis

---

## 🚨 Alert Thresholds

### Critical Alerts (Immediate Action)

**Service Down**
```
up{job="blueMQ-api"} == 0
```
Service is unreachable.

**Swap Usage > 0**
```
system_swap_usage{state="used"} > 0
```
Server is swapping. Add RAM or investigate memory leak.

**Error Rate > 0.1/sec**
```
rate(http_server_errors_total[5m]) > 0.1
```
High error rate. Check error logs and traces.

**Memory > 90%**
```
system_memory_utilization > 0.9
```
Severe memory pressure. May lead to OOM kills.

### Warning Alerts (Investigate Soon)

**Error Ratio > 1%**
```
(rate(http_server_requests_total{status_class="5xx"}[5m]) / 
 rate(http_server_requests_total[5m])) > 0.01
```
More than 1% of requests failing.

**High Latency (p95 > 1s)**
```
histogram_quantile(0.95, rate(http_server_duration_seconds_bucket[5m])) > 1
```
Performance degradation.

**Event Loop Lag > 100ms**
```
nodejs_eventloop_delay_p99_seconds > 0.1
```
Node.js is blocked. Check for blocking operations.

**Memory > 80%**
```
system_memory_utilization > 0.8
```
High memory usage. May start swapping soon.

---

## 🔍 Common Investigation Patterns

### High Error Rate

1. Check **Error Timeline** for spike
2. Review **Recent Error Logs** for error messages
3. Click **Failed Traces** to see affected requests
4. Correlate with deployments or traffic spikes
5. Check **System Resources** for CPU/memory issues

### Slow Response Times

1. Check **Latency Percentiles** - which percentile is high?
2. Look at **Traffic by Endpoint** - which route is slow?
3. Check **Event Loop Lag** - is Node.js blocked?
4. Review **GC Duration** - excessive garbage collection?
5. Look at **Process CPU** - CPU bottleneck?

### Memory Issues

1. Check **Process Memory** - growing linearly? (leak)
2. Check **V8 Heap** - heap exhaustion?
3. Check **System Memory %** - overall pressure?
4. Check **Swap Usage** - started swapping? (critical!)
5. Review **GC Duration** - frequent collections? (pressure)

### CPU Spikes

1. Check **Process CPU** - which process?
2. Check **System CPU** - overall server load?
3. Check **Traffic by Endpoint** - traffic spike?
4. Check **Event Loop Lag** - CPU-intensive operations?
5. Review recent deployments or code changes

---

## 📋 Metric Reference

### HTTP Metrics

| Metric | Description | Type |
|--------|-------------|------|
| `http_server_requests_total` | Total HTTP requests | Counter |
| `http_server_errors_total` | Total 5xx errors | Counter |
| `http_server_duration_seconds` | Request duration | Histogram |

**Labels:** `route`, `method`, `status_class`

### System Metrics

| Metric | Description | Type |
|--------|-------------|------|
| `system_cpu_utilization` | Server CPU % (0-1) | Gauge |
| `system_memory_utilization` | Server memory % (0-1) | Gauge |
| `system_swap_usage` | Swap memory (bytes) | Gauge |
| `system_network_io_total` | Network bytes in/out | Counter |

**Labels:** `state` (used/free/total), `direction` (receive/transmit)

### Process Metrics

| Metric | Description | Type |
|--------|-------------|------|
| `process_memory_usage` | Process RSS memory (bytes) | Gauge |
| `process_cpu_time_seconds_total` | CPU time consumed | Counter |

**Labels:** `instance` (PM2 process ID)

### Node.js Runtime Metrics

| Metric | Description | Type |
|--------|-------------|------|
| `nodejs_eventloop_delay_p99_seconds` | Event loop lag p99 | Gauge |
| `nodejs_eventloop_utilization_ratio` | Event loop busy % (0-1) | Gauge |
| `v8js_memory_heap_used_bytes` | Heap memory used | Gauge |
| `v8js_gc_duration_seconds` | GC duration | Histogram |

**Labels:** `instance`, `space_name` (heap spaces)

---

## 🎯 PromQL Query Examples

### Request Rate by Route
```promql
sum by (route, method) (
  rate(http_server_requests_total{service_name="blueMQ-api"}[5m])
)
```

### Error Rate
```promql
sum(rate(http_server_errors_total{service_name="blueMQ-api"}[5m]))
```

### Success Rate %
```promql
(
  sum(rate(http_server_requests_total{status_class=~"2xx|3xx"}[5m])) /
  sum(rate(http_server_requests_total[5m]))
) * 100
```

### p95 Latency
```promql
histogram_quantile(0.95, 
  sum by (le) (
    rate(http_server_duration_seconds_bucket{service_name="blueMQ-api"}[5m])
  )
)
```

### Memory Usage
```promql
process_memory_usage{service_name="blueMQ-api"} / 1024 / 1024
```

### Event Loop Lag
```promql
nodejs_eventloop_delay_p99_seconds{service_name="blueMQ-api"} * 1000
```

---

## 📝 LogQL Query Examples

### All Logs
```logql
{service_name="blueMQ-api"}
```

### Error Logs Only
```logql
{service_name="blueMQ-api"} | detected_level=~"error|fatal|critical"
```

### Logs with Trace ID
```logql
{service_name="blueMQ-api"} | json | trace_id!=""
```

### HTTP Request Logs
```logql
{service_name="blueMQ-api"} | json | message=~".*\\[http\\].*"
```

### Search by Keyword
```logql
{service_name="blueMQ-api"} |= "database" | json
```

---

## 🔗 Trace Query Examples

### All Traces
```
{resource.service.name="blueMQ-api"}
```

### Failed Requests
```
{resource.service.name="blueMQ-api" && status=error}
```

### Slow Requests (> 1s)
```
{resource.service.name="blueMQ-api" && duration > 1s}
```

### Specific Route
```
{resource.service.name="blueMQ-api" && name="/api/notifications"}
```

---

## 🛠️ Troubleshooting

### No Data in Dashboard

**Check:**
1. Is service running? `pm2 status`
2. Is telemetry enabled? Check `.env`: `TELEMETRY_ENABLED=true`
3. Check PM2 logs: `pm2 logs blueMQ-api | grep telemetry`
4. Verify endpoint: Should see "Started service=blueMQ-api"

### Metrics Missing

**Common causes:**
- Service restarted recently (wait 1-2 minutes)
- Wrong time range selected (expand to "Last 1 hour")
- Instance filter set incorrectly (change to "All")
- Network issue (check firewall, HTTPS outbound to Grafana Cloud)

### Logs Not Appearing

**Check:**
1. Loki data source connected
2. Log level: `LOG_LEVEL=info` (not "error" only)
3. Winston transport loaded: Check startup logs
4. Query correct time range

### Traces Missing

**Check:**
1. Sampling rate: `OTEL_TRACES_SAMPLER_ARG` (higher = more traces)
2. Tempo data source connected
3. Recent traffic to application (no traffic = no traces)

---

## 🎓 Best Practices

### Monitoring Routine

**Daily (5 minutes):**
- Check dashboard health status (top row)
- Scan for red/yellow panels
- Review error logs if any

**Weekly (15 minutes):**
- Review traffic patterns
- Check latency trends
- Verify memory/CPU stable
- Review alert history

**Monthly (30 minutes):**
- Capacity planning (review growth trends)
- Update alert thresholds if needed
- Review dashboard effectiveness
- Clean up old logs/traces

### Performance Baselines

**Record normal values for:**
- Request rate during peak hours
- Typical p95 latency
- Normal memory usage per process
- Expected CPU utilization

**Use baselines to:**
- Detect anomalies quickly
- Set appropriate alert thresholds
- Measure impact of changes

### Incident Response

**When alert fires:**
1. Open dashboard
2. Check time range matches alert time
3. Review all panels for correlations
4. Check error logs and traces
5. Document findings
6. Apply fix
7. Monitor for resolution

---

## 📚 Additional Resources

**Grafana Cloud:** https://slimhoneydew2834.grafana.net  
**Prometheus Docs:** https://prometheus.io/docs/  
**PromQL Guide:** https://prometheus.io/docs/prometheus/latest/querying/basics/  
**LogQL Guide:** https://grafana.com/docs/loki/latest/logql/  
**TraceQL Guide:** https://grafana.com/docs/tempo/latest/traceql/

---

## 🔧 Configuration

### Environment Variables

Required in `.env` or PM2 config:

```bash
# Enable telemetry
TELEMETRY_ENABLED=true

# Service identification
OTEL_SERVICE_NAME=blueMQ-api
DEPLOYMENT_ENV=production

# Grafana Cloud endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-ap-south-1.grafana.net/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <your-token>

# Sampling (production: 0.05 = 5%)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05

# Export intervals
OTEL_METRIC_EXPORT_INTERVAL_MS=10000
OTEL_METRIC_EXPORT_TIMEOUT_MS=5000
```

### PM2 Process Names

Ensure each PM2 process has unique `OTEL_SERVICE_NAME`:
- API: `blueMQ-api`
- Email worker: `blueMQ-worker-email`
- Push worker: `blueMQ-worker-push`
- SMS worker: `blueMQ-worker-sms`
- WhatsApp worker: `blueMQ-worker-whatsapp`

---

*Last updated: 2026-11-19*
