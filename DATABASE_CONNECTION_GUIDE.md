# Database Connection Troubleshooting Guide

## Overview

BlueMQ uses Neon Postgres with the `@neondatabase/serverless` driver. This guide helps resolve connection issues, especially in production environments with varying network conditions.

## Recent Improvements

The database connection layer now includes:

1. **Automatic retry logic** with exponential backoff
2. **Configurable connection timeouts**
3. **Health check before migrations**
4. **Better error messages** with troubleshooting hints

## Configuration

Add these optional environment variables to `.env` to tune connection behavior:

```bash
# Database connection settings (optional - defaults shown)
DB_CONNECTION_TIMEOUT_MS=30000    # Connection timeout in milliseconds
DB_MAX_RETRIES=3                   # Maximum retry attempts for failed connections
DB_RETRY_DELAY_MS=2000             # Initial retry delay (doubles with each retry)
```

### For Slow Networks (e.g., DigitalOcean Droplets)

If you're experiencing timeouts on droplets or servers with poor connectivity:

```bash
DB_CONNECTION_TIMEOUT_MS=60000     # Increase timeout to 60 seconds
DB_MAX_RETRIES=5                    # Try up to 5 times
DB_RETRY_DELAY_MS=3000              # Start with 3s delay
```

### For Fast Networks (e.g., Railway, AWS)

If you're on cloud platforms with good connectivity:

```bash
DB_CONNECTION_TIMEOUT_MS=15000     # Faster timeout
DB_MAX_RETRIES=2                    # Fewer retries needed
DB_RETRY_DELAY_MS=1000              # Quick retry
```

## Common Issues & Solutions

### 1. `ETIMEDOUT` Error

**Symptom:**

```
NeonDbError: Error connecting to database: TypeError: fetch failed
  [cause]: AggregateError [ETIMEDOUT]
```

**Causes & Solutions:**

#### A. Firewall Blocking Outbound Connections

```bash
# Test if you can reach Neon endpoint
curl -v https://your-neon-host.neon.tech

# If this fails, check firewall rules
sudo ufw status
sudo ufw allow out 5432/tcp
```

#### B. DNS Resolution Issues

```bash
# Test DNS resolution
nslookup your-neon-host.neon.tech

# If slow/failing, try using Google DNS
# Add to /etc/resolv.conf:
nameserver 8.8.8.8
nameserver 8.8.4.4
```

#### C. IPv6 Configuration

The `.env` includes `NODE_OPTIONS=--dns-result-order=ipv6first` for Railway.

On droplets without proper IPv6, try:

```bash
# Remove or comment out in .env
# NODE_OPTIONS=--dns-result-order=ipv6first
```

#### D. Neon Database Suspended

- Log into [Neon Console](https://console.neon.tech)
- Check if database is active (not paused/suspended)
- Free tier databases auto-suspend after inactivity

### 2. Connection Works Locally, Fails in Production

**Diagnosis:**

```bash
# SSH into your server
ssh user@your-droplet-ip

# Test from production server
cd ~/blueMQ
node src/db/migrate.js
```

**Common Causes:**

- Server IP not in Neon's IP allowlist (if enabled)
- Different network routes/latency
- Missing environment variables

**Solution:**

```bash
# Check .env is present and correct
cat .env | grep DATABASE_URL

# Test connectivity
curl -v https://$(echo $DATABASE_URL | grep -oP '(?<=@)[^/]+')
```

### 3. Works on First Run, Fails in PM2

**Issue:**
PM2 might not load `.env` correctly or has stale processes.

**Solution:**

```bash
# Stop all PM2 processes
pm2 delete all

# Start fresh (PM2 will load .env)
pm2 start ecosystem.config.js

# Check logs
pm2 logs bluemq --lines 50
```

### 4. Random Connection Failures

If connection succeeds sometimes but fails randomly:

**Increase retries:**

```bash
DB_MAX_RETRIES=5
DB_RETRY_DELAY_MS=3000
```

**Check network stability:**

```bash
# Ping Neon endpoint continuously
ping -c 100 your-neon-host.neon.tech

# Check for packet loss
```

## Health Check Endpoint

The app includes a health check that verifies database connectivity:

```bash
curl http://localhost:3001/health
```

Response on success:

```json
{
  "status": "ok",
  "timestamp": "2026-04-08T07:00:00.000Z",
  "database": "connected"
}
```

## Advanced Debugging

### Enable Detailed Logs

Add to your start command:

```bash
NODE_ENV=development npm start
```

### Test Connection Directly with psql

```bash
# Install PostgreSQL client
sudo apt-get install postgresql-client

# Test connection
psql "postgresql://user:pass@host/db?sslmode=require"
```

### Network Trace

```bash
# Install tcpdump
sudo apt-get install tcpdump

# Capture traffic to Neon (replace with your host)
sudo tcpdump -i any host your-neon-host.neon.tech -w neon-traffic.pcap

# Run your app and analyze the capture
```

## Migration Best Practices

1. **Test connection before deploying:**

   ```bash
   npm run migrate
   ```

2. **Run migrations separately from app start:**

   ```bash
   # In deployment script
   npm run migrate && npm start
   ```

3. **Monitor migration progress:**
   The migration now logs progress every 3 statements for visibility.

4. **Keep schemas idempotent:**
   Use `IF NOT EXISTS` so migrations can be re-run safely.

## Contact & Support

- **Neon Status:** https://status.neon.tech
- **Neon Docs:** https://neon.tech/docs
- **Check Neon Limits:** Free tier has connection limits

## Rollback

If the new retry logic causes issues, you can temporarily disable it:

```bash
# Set retries to 1 (no retry)
DB_MAX_RETRIES=1
```

This will behave like the original code but with better error messages.
