# Deployment Guide - Database Connection Fix

## Quick Deploy to Ubuntu Droplet

### 1. Stop the Current App

```bash
ssh user@your-droplet-ip
cd ~/blueMQ
pm2 stop bluemq
# or
pm2 delete bluemq
```

### 2. Pull the Latest Changes

```bash
git pull origin main
```

### 3. Test Database Connection

Before starting the app, verify the database is accessible:

```bash
npm run test:db
```

Expected output:

```
✅ SUCCESS: Connected to database in XXXXms
📊 Database Info:
   Version: PostgreSQL 17.8...
   Database: neondb
   User: neondb_owner
✅ All tests passed!
```

If the test fails, see troubleshooting section below.

### 4. Run Migration

```bash
npm run migrate
```

Expected output:

```
[migrate] Testing database connection...
[migrate] Connection test successful.
[migrate] Running schema migration (13 statements)...
[migrate] Progress: 3/13 statements completed
[migrate] Progress: 6/13 statements completed
[migrate] Progress: 9/13 statements completed
[migrate] Progress: 12/13 statements completed
[migrate] Schema migration complete.
```

### 5. Start the App

```bash
pm2 start ecosystem.config.js
pm2 save
```

### 6. Monitor Logs

```bash
pm2 logs bluemq --lines 50
```

Look for:

```
[migrate] Testing database connection...
[migrate] Connection test successful.
[migrate] Running schema migration (13 statements)...
[migrate] Schema migration complete.
[server] Listening on port 3001
```

### 7. Verify App is Running

```bash
pm2 status
curl http://localhost:3001/health
```

## Troubleshooting on Droplet

### Test Fails with ETIMEDOUT

**Option 1: Increase Timeout (Recommended)**

Edit `.env` on the droplet:

```bash
nano ~/blueMQ/.env
```

Add these lines:

```bash
DB_CONNECTION_TIMEOUT_MS=60000
DB_MAX_RETRIES=5
DB_RETRY_DELAY_MS=3000
```

Save and test again:

```bash
npm run test:db
```

**Option 2: Check Network Connectivity**

```bash
# Test if you can reach Neon
curl -v https://ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech

# Check DNS resolution
nslookup ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech

# Test with ping
ping ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech
```

**Option 3: Check Firewall**

```bash
# Check firewall status
sudo ufw status

# Allow outbound PostgreSQL connections
sudo ufw allow out 5432/tcp

# If using iptables
sudo iptables -L OUTPUT -n -v | grep 5432
```

### App Crashes Repeatedly

```bash
# Check PM2 logs
pm2 logs bluemq --err --lines 100

# Check if it's still timing out
tail -f ~/blueMQ/logs/error.log

# Delete and restart fresh
pm2 delete bluemq
pm2 start ecosystem.config.js
```

### IPv6 Issues

If you see DNS-related errors and your droplet doesn't have IPv6:

```bash
# Edit .env
nano ~/blueMQ/.env

# Comment out or remove this line:
# NODE_OPTIONS=--dns-result-order=ipv6first

# Or change to IPv4 first:
NODE_OPTIONS=--dns-result-order=ipv4first
```

Restart:

```bash
pm2 restart bluemq
```

### Database Appears Suspended in Neon

1. Go to [Neon Console](https://console.neon.tech)
2. Check your database status
3. Free tier databases auto-suspend after inactivity
4. Click "Wake" or run any query to wake it up
5. Run `npm run test:db` again

### Connection Works But Migration Fails

If test passes but migration fails:

```bash
# Run migration with more verbose output
node src/db/migrate.js

# Check schema file
cat src/db/schema.sql

# Test with a simple query
node -e "require('dotenv').config(); const {getDb} = require('./src/db'); getDb()\`SELECT 1\`.then(() => console.log('OK')).catch(e => console.error(e))"
```

## Environment-Specific Configuration

### For DigitalOcean Droplets (Slower Network)

Add to `.env`:

```bash
DB_CONNECTION_TIMEOUT_MS=60000
DB_MAX_RETRIES=5
DB_RETRY_DELAY_MS=3000
```

### For Railway/Fly.io (Fast Network)

Use defaults or:

```bash
DB_CONNECTION_TIMEOUT_MS=20000
DB_MAX_RETRIES=2
DB_RETRY_DELAY_MS=1000
```

### For Development (Local)

No changes needed - defaults work fine.

## Automated Deployment Script

Create `scripts/deploy-droplet.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying BlueMQ to Droplet..."

# Stop app
echo "⏸️  Stopping app..."
pm2 stop bluemq || true

# Pull latest
echo "📥 Pulling latest changes..."
git pull origin main

# Test connection
echo "🔍 Testing database connection..."
npm run test:db

# Run migration
echo "🗄️  Running migrations..."
npm run migrate

# Start app
echo "▶️  Starting app..."
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Show status
echo "✅ Deployment complete!"
pm2 status
pm2 logs bluemq --lines 20
```

Make it executable:

```bash
chmod +x scripts/deploy-droplet.sh
```

Use it:

```bash
cd ~/blueMQ
./scripts/deploy-droplet.sh
```

## Rollback

If something goes wrong:

```bash
# Stop the app
pm2 stop bluemq

# Go back to previous commit
git log --oneline -5
git checkout <previous-commit-hash>

# Restart
pm2 start ecosystem.config.js
```

## Monitoring

Set up monitoring to catch issues early:

```bash
# Watch PM2 status
watch -n 5 pm2 status

# Continuous log monitoring
pm2 logs bluemq --lines 50 --raw

# Check for restart loops
pm2 info bluemq | grep restarts
```

If restart count is high:

```bash
pm2 reset bluemq  # Reset restart counter
pm2 logs bluemq   # Check why it's restarting
```

## Success Checklist

After deployment, verify:

- [ ] `pm2 status` shows "online" not "launching"
- [ ] `pm2 logs` shows no errors
- [ ] `curl localhost:3001/health` returns 200
- [ ] Database connection test passes
- [ ] No repeated restarts in PM2

## Support

If issues persist after following this guide:

1. Check `DATABASE_CONNECTION_GUIDE.md` for detailed troubleshooting
2. Run `npm run test:db` and share the output
3. Share PM2 logs: `pm2 logs bluemq --err --lines 100`
4. Check Neon status: https://status.neon.tech

## Post-Deployment Validation

Test all endpoints work:

```bash
# Health check
curl http://localhost:3001/health

# Test protected endpoint (replace with actual API key)
curl -H "x-api-key: your-test-api-key" http://localhost:3001/templates
```

Good luck! 🚀
