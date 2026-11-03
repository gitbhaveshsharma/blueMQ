# Grafana Cloud Setup Guide for BlueMQ

This guide walks you through setting up Grafana Cloud for OpenTelemetry observability with BlueMQ.

---

## Prerequisites

- BlueMQ deployed on production server
- Node.js v22.15.0+ installed
- `TELEMETRY_ENABLED=true` in your `.env`

---

## Step 1: Sign Up for Grafana Cloud

1. Go to https://grafana.com/auth/sign-up/create-user
2. Create a free account (Free tier includes):
   - 50 GB traces per month
   - 10,000 series for metrics
   - 50 GB logs per month

3. After signup, you'll be redirected to your Grafana Cloud portal

---

## Step 2: Get OpenTelemetry (OTLP) Credentials

### Option A: Via Grafana Cloud UI

1. In Grafana Cloud, go to **Connections** → **Add new connection**
2. Search for **"OpenTelemetry"** or **"OTLP"**
3. Click **"OpenTelemetry (OTLP)"**
4. You'll see three pieces of information:

   ```
   OTLP Endpoint: https://otlp-gateway-prod-{region}.grafana.net/otlp
   Instance ID: 123456
   Access Token: glc_xxxxxxxxxxxxxxxxxxxxx
   ```

### Option B: Via Grafana Cloud Settings

1. Go to **Settings** → **Access Policies**
2. Create a new Access Policy:
   - **Name**: `BlueMQ-OTLP`
   - **Scopes**: Select `traces:write`, `metrics:write`, `logs:write`
   - Click **Create**
3. Copy the generated token (starts with `glc_`)

---

## Step 3: Encode Authentication Header

Grafana Cloud OTLP uses Basic Auth with format: `{instanceId}:{token}`

### On Your Production Server:

```bash
# SSH to production
ssh bhavesh@bluemq-server

# Set your credentials (replace with actual values)
INSTANCE_ID="123456"
TOKEN="glc_xxxxxxxxxxxxxxxxxxxxx"

# Generate Base64 encoded auth header
AUTH_HEADER=$(echo -n "${INSTANCE_ID}:${TOKEN}" | base64)

# Verify (should output a long string)
echo $AUTH_HEADER
```

**Example output:**
```
MTIzNDU2OmdsY194eHh4eHh4eHh4eHh4eHh4eHh4eHh4eA==
```

---

## Step 4: Update Production `.env`

```bash
# Still on production server
cd ~/blueMQ
nano .env
```

Add/update these lines (replace with your actual values):

```bash
# ─── OpenTelemetry (Grafana Cloud) ───
TELEMETRY_ENABLED=true
TELEMETRY_DEBUG_CONSOLE=false
DEPLOYMENT_ENVIRONMENT=production

# Replace {region} with your region: us-east-0, eu-west-0, etc.
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp

# Paste the Base64 string from Step 3
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic MTIzNDU2OmdsY194eHh4eHh4eHh4eHh4eHh4eHh4eHh4eA==

# Sampling (10% to control costs)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1

# Optional: Batch tuning (defaults are already optimized)
# OTEL_BSP_SCHEDULE_DELAY=5000
# OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
# OTEL_METRIC_EXPORT_INTERVAL_MS=60000
```

**Save and exit**: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 5: Restart Services

```bash
# Restart all PM2 processes
pm2 restart ecosystem.config.js

# Monitor logs for telemetry initialization
pm2 logs | grep -i telemetry
```

**Expected output:**
```
[telemetry] Started service=blueMQ-api instance=1234567 env=production exporters=otlp sampler=parentbased_traceidratio(0.1)
```

**No errors expected** ✅

---

## Step 6: Verify Telemetry Export

### Test from Production Server

```bash
# Test OTLP endpoint connectivity
curl -X POST https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces \
  -H "Authorization: Basic YOUR_BASE64_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[]}'
```

**Expected responses:**
- ✅ `200 OK` or `400 Bad Request` = Auth works, endpoint reachable
- ❌ `401 Unauthorized` = Wrong credentials
- ❌ `Connection refused` = Wrong endpoint or firewall blocking

### Generate Test Traffic

```bash
# Hit your API to generate traces
curl http://localhost:3001/health
curl http://localhost:3001/ready
```

---

## Step 7: View Traces in Grafana Cloud

1. Open your Grafana Cloud portal
2. Go to **Explore** (compass icon in left sidebar)
3. Select **Tempo** as the data source (top dropdown)
4. Query: `{service.name="blueMQ-api"}`
5. Click **Run query**

**Expected**: Traces should appear within 1-2 minutes ✅

---

## Step 8: Set Up Dashboards

### Import Pre-built Dashboard

1. Go to **Dashboards** → **New** → **Import**
2. Enter dashboard ID: `19419` (OpenTelemetry APM)
3. Click **Load**
4. Select **Tempo** as data source for traces
5. Select **Prometheus** as data source for metrics
6. Click **Import**

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `http.server.request.count` | Total requests | N/A |
| `http.server.error.count` | 5xx errors | > 10/min |
| `http.server.duration` | Response time | p95 > 2s |
| BullMQ queue depth | Pending jobs | > 1000 |

---

## Step 9: Configure Alerts (Optional)

### Example: Alert on High Error Rate

1. Go to **Alerting** → **Alert rules** → **New alert rule**
2. **Alert name**: `High Error Rate - BlueMQ`
3. **Query**:
   ```promql
   rate(http_server_error_count_total{service_name="blueMQ-api"}[5m]) > 0.1
   ```
4. **Condition**: Alert if above threshold for 2 minutes
5. **Contact point**: Email or Slack
6. Click **Save**

---

## Troubleshooting

### Issue: No Traces in Grafana

**Check logs:**
```bash
pm2 logs bluemq-api | grep -i "telemetry\|otel\|error"
```

**Common causes:**
- ❌ Wrong OTLP endpoint (check region)
- ❌ Invalid Base64 auth header (regenerate)
- ❌ Firewall blocking outbound HTTPS to Grafana
- ❌ Sampling too low (temporarily set to 1.0)

**Quick test:**
```bash
# In .env, temporarily set:
OTEL_TRACES_SAMPLER_ARG=1.0  # 100% sampling

# Restart and test
pm2 restart ecosystem.config.js
curl http://localhost:3001/health
```

---

### Issue: Traces Present but No Metrics

**Check:**
```bash
# Metrics export every 60 seconds by default
# Wait 2 minutes, then check Grafana Explore with Prometheus
```

**Query in Grafana:**
```promql
http_server_request_count_total{service_name="blueMQ-api"}
```

---

### Issue: 401 Unauthorized

**Regenerate auth header:**
```bash
# Double-check your instance ID and token
echo -n "INSTANCE_ID:TOKEN" | base64

# Update OTEL_EXPORTER_OTLP_HEADERS in .env
# Restart: pm2 restart ecosystem.config.js
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEMETRY_ENABLED` | Yes | `false` | Master switch for telemetry |
| `TELEMETRY_DEBUG_CONSOLE` | No | `false` | Print to console instead of OTLP |
| `DEPLOYMENT_ENVIRONMENT` | Yes | `development` | Environment label (production/staging/dev) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes* | N/A | Grafana OTLP gateway URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | Yes* | N/A | Base64 Basic Auth header |
| `OTEL_TRACES_SAMPLER` | No | `parentbased_traceidratio` | Sampling strategy |
| `OTEL_TRACES_SAMPLER_ARG` | No | `1.0` | Sampling ratio (0.0-1.0) |
| `OTEL_SERVICE_NAME` | No | Auto-set by PM2 | Service name label |

\* Required when `TELEMETRY_ENABLED=true` and not using console export

---

## Sampling Recommendations

| Environment | Sampling Rate | Traces/Day (10k req/day) | Cost Impact |
|-------------|---------------|--------------------------|-------------|
| Development | 1.0 (100%) | 10,000 | High |
| Staging | 0.5 (50%) | 5,000 | Medium |
| Production (low traffic) | 0.1 (10%) | 1,000 | Low |
| Production (high traffic) | 0.05 (5%) | 500 | Very Low |

**Note:** Errors are always captured regardless of sampling (head-based sampling).

---

## Security Best Practices

1. **Never commit** `.env` or auth tokens to git
2. **Rotate tokens** every 90 days
3. **Use separate tokens** for staging and production
4. **Restrict access policies** to minimum required scopes
5. **Monitor token usage** in Grafana Cloud settings

---

## Next Steps

After Grafana Cloud is working:

1. ✅ Set up custom dashboards for your KPIs
2. ✅ Configure alerts for critical metrics
3. ✅ Enable log shipping to Loki (optional)
4. ✅ Set up on-call rotation with PagerDuty/OpsGenie
5. ✅ Document runbooks for common alerts

---

## Support

- **Grafana Cloud Docs**: https://grafana.com/docs/grafana-cloud/
- **OpenTelemetry Docs**: https://opentelemetry.io/docs/
- **BlueMQ Issues**: https://github.com/your-repo/blueMQ/issues

---

## Summary Checklist

- [ ] Grafana Cloud account created
- [ ] OTLP credentials obtained
- [ ] Base64 auth header generated
- [ ] Production `.env` updated
- [ ] Services restarted
- [ ] Traces visible in Grafana Tempo
- [ ] Metrics visible in Grafana Prometheus
- [ ] Dashboard imported
- [ ] Alerts configured
- [ ] Team access granted
