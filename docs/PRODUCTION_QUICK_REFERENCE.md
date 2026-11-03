# BlueMQ Production Quick Reference

Quick commands and configuration for production deployment.

---

## Essential Commands

```bash
# Check service status
pm2 status

# View logs (all processes)
pm2 logs

# View specific process logs
pm2 logs bluemq-api
pm2 logs bluemq-worker-push

# Restart all services
pm2 restart ecosystem.config.js

# Reload without downtime
pm2 reload ecosystem.config.js

# Stop all services
pm2 stop all

# Check health
curl http://localhost:3001/health
curl http://localhost:3001/ready

# Monitor real-time
pm2 monit

# Clear logs
pm2 flush
```

---

## Environment Variables Setup

```bash
# Generate SERVICE_API_KEY_SECRET
openssl rand -hex 32

# Generate Grafana Cloud auth header
echo -n "INSTANCE_ID:TOKEN" | base64

# Edit .env
cd ~/blueMQ
nano .env

# Validate configuration
./scripts/production-setup.sh
```

---

## Minimal Required `.env` for Production

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=verify-full

# Redis
REDIS_URL=redis://default:password@host:port
REDIS_TLS_ENABLED=true

# Security (CRITICAL - Generate with: openssl rand -hex 32)
SERVICE_API_KEY_SECRET=your_generated_secret_here

# Telemetry (Grafana Cloud)
TELEMETRY_ENABLED=true
DEPLOYMENT_ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-REGION.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic YOUR_BASE64_HERE
OTEL_TRACES_SAMPLER_ARG=0.1

# Providers (at least one per channel)
PROVIDER_PUSH_FIREBASE=true
PROVIDER_EMAIL_RESEND=true
PROVIDER_SMS_ONESIGNAL=true
PROVIDER_WHATSAPP_META=true
PROVIDER_CALL_MSG91=true

# Provider API Keys (get from respective services)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
RESEND_API_KEY=...
ONESIGNAL_APP_ID=...
ONESIGNAL_API_KEY=...
MSG91_AUTH_KEY=...
```

---

## Deployment Workflow

```bash
# 1. Pull latest code
cd ~/blueMQ
git pull origin main

# 2. Install dependencies
npm install

# 3. Run migrations (if any)
npm run migrate

# 4. Validate configuration
./scripts/production-setup.sh

# 5. Restart services
pm2 restart ecosystem.config.js

# 6. Monitor logs for errors
pm2 logs --lines 50

# 7. Health check
curl http://localhost:3001/health
curl http://localhost:3001/ready
```

---

## Grafana Cloud Regions

| Region | Endpoint |
|--------|----------|
| US East | `https://otlp-gateway-prod-us-east-0.grafana.net/otlp` |
| US West | `https://otlp-gateway-prod-us-west-0.grafana.net/otlp` |
| EU West | `https://otlp-gateway-prod-eu-west-0.grafana.net/otlp` |
| EU Central | `https://otlp-gateway-prod-eu-central-0.grafana.net/otlp` |
| Asia Pacific | `https://otlp-gateway-prod-ap-southeast-0.grafana.net/otlp` |

---

## Security Checklist

- [ ] `SERVICE_API_KEY_SECRET` set (not default)
- [ ] `DATABASE_URL` uses `sslmode=verify-full`
- [ ] `REDIS_TLS_ENABLED=true` in production
- [ ] Grafana Cloud token rotated every 90 days
- [ ] `.env` not committed to git
- [ ] Firewall allows outbound HTTPS to Grafana Cloud
- [ ] Phase 2 security features enabled gradually

---

## Monitoring Checklist

- [ ] Grafana Cloud account active
- [ ] Traces appearing in Tempo
- [ ] Metrics appearing in Prometheus
- [ ] Dashboard configured
- [ ] Alerts set up for critical errors
- [ ] On-call rotation configured

---

## Troubleshooting

### No telemetry in Grafana Cloud

```bash
# Check logs
pm2 logs bluemq-api | grep -i telemetry

# Test OTLP endpoint
curl -X POST $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces \
  -H "Authorization: Basic YOUR_BASE64" \
  -d '{}'

# Expected: 200 OK or 400 (not 401)
```

### High memory usage

```bash
# Check per-process memory
pm2 monit

# Restart if needed
pm2 restart ecosystem.config.js
```

### Database connection issues

```bash
# Check logs
pm2 logs | grep -i "db\|pool\|neon"

# Test connection
npm run test:db

# Check Neon console for compute status
```

### Redis connection issues

```bash
# Check Redis status
redis-cli ping

# Check logs
pm2 logs | grep -i redis

# Verify REDIS_URL in .env
```

---

## Performance Tips

1. **Enable batch template queries**:
   ```bash
   ENABLE_BATCH_TEMPLATE_QUERIES=true
   ```

2. **Enable Redis template cache** (after testing):
   ```bash
   ENABLE_REDIS_TEMPLATE_CACHE=true
   ```

3. **Optimize sampling** (production):
   ```bash
   OTEL_TRACES_SAMPLER_ARG=0.05  # 5% sampling
   ```

4. **Monitor queue depths**:
   ```bash
   pm2 logs | grep -i "queue\|worker"
   ```

---

## Emergency Procedures

### Complete restart

```bash
pm2 kill
pm2 start ecosystem.config.js
pm2 save
```

### Rollback deployment

```bash
cd ~/blueMQ
git log --oneline  # Find previous commit
git checkout COMMIT_HASH
npm install
pm2 restart ecosystem.config.js
```

### Clear all queues

```bash
# Connect to Redis
redis-cli

# List all BullMQ keys
KEYS bull:notifications-*

# Delete specific queue (CAREFUL!)
DEL bull:notifications-push

# Exit
exit
```

---

## Useful Log Filters

```bash
# Errors only
pm2 logs | grep -i error

# Telemetry status
pm2 logs | grep -i telemetry

# Database operations
pm2 logs | grep -i "\[db\]"

# Queue operations
pm2 logs | grep -i "\[queue\]"

# Security events
pm2 logs | grep -i "\[security\]"

# Specific time range (using journalctl if systemd-managed)
journalctl -u pm2-bhavesh --since "10 minutes ago"
```

---

## Contact & Support

- **Documentation**: `/Volumes/projact-z/blueMQ/docs/`
- **Grafana Cloud**: https://grafana.com/docs/
- **Issues**: Create ticket in your issue tracker
