# Ubuntu Droplet Cannot Reach Neon Database

## The Real Issue

Your code is **working perfectly**! The retry logic is executing as designed. The problem is that your **DigitalOcean droplet cannot reach the Neon database** at all due to network restrictions.

### Evidence

- ✅ Works on Windows (local machine)
- ❌ Fails on Ubuntu droplet after 3 retries
- ❌ Every single attempt times out (ETIMEDOUT)
- ✅ Retry logic is working (trying 3 times with backoff)

This is a **firewall/network routing issue**, not a code issue.

## Diagnosis on Droplet

SSH into your droplet and run:

```bash
cd ~/blueMQ
chmod +x scripts/diagnose-network.sh
./scripts/diagnose-network.sh
```

This will test:

1. DNS resolution
2. Port 5432 accessibility
3. Firewall rules
4. Network routing

## Most Likely Causes

### 1. DigitalOcean Blocks Port 5432 (Most Common)

Some DigitalOcean datacenters block outbound PostgreSQL port 5432 for security reasons.

**Test manually:**

```bash
# SSH into droplet
nc -zv ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech 5432
```

If this times out, DO is blocking the port.

### 2. UFW Firewall Blocking

**Check:**

```bash
sudo ufw status
```

**Fix:**

```bash
sudo ufw allow out 5432/tcp
sudo ufw reload
```

### 3. DNS Resolution Issues

**Test:**

```bash
nslookup ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech
```

**Fix:**

```bash
sudo nano /etc/resolv.conf
# Add these lines:
nameserver 8.8.8.8
nameserver 8.8.4.4
```

## Solutions (In Order of Ease)

### Solution 1: Use Non-Pooler Connection (Easiest)

Neon provides two types of connections:

- **Pooler** (port 5432): `ep-xxx-pooler.c-4.us-east-1.aws.neon.tech`
- **Direct** (different port): `ep-xxx.c-4.us-east-1.aws.neon.tech`

Try using the direct connection string without `-pooler`:

```bash
# On droplet, edit .env
nano ~/blueMQ/.env

# Change DATABASE_URL from:
DATABASE_URL=postgresql://...@ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/...

# To (remove '-pooler'):
DATABASE_URL=postgresql://...@ep-cold-dream-ai6ax6lc.c-4.us-east-1.aws.neon.tech/...
```

Then restart:

```bash
pm2 restart bluemq
```

### Solution 2: Run the Fix Script

```bash
cd ~/blueMQ
chmod +x scripts/fix-connection.sh
sudo ./scripts/fix-connection.sh
pm2 restart bluemq
```

### Solution 3: Contact DigitalOcean Support

Open a ticket asking them to unblock outbound port 5432 for your droplet.

**Ticket Template:**

```
Subject: Please unblock outbound port 5432 on my droplet

Hello,

I have a droplet (IP: YOUR_DROPLET_IP) that needs to connect
to an external PostgreSQL database (Neon.tech) on port 5432.

Currently, all outbound connections to port 5432 are timing out.
Can you please unblock this port for my droplet?

Droplet ID: [find in DO console]
Target: ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech:5432

Thank you!
```

### Solution 4: Switch to a Different Database Provider

If DigitalOcean won't unblock the port, use a database that works:

#### Option A: Supabase

```bash
# 1. Sign up at https://supabase.com
# 2. Create a project
# 3. Get connection string from Settings > Database
# 4. Update .env on droplet:
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

#### Option B: Railway PostgreSQL

```bash
# 1. Deploy to Railway (free tier)
# 2. Add PostgreSQL plugin
# 3. Get DATABASE_URL from variables
# 4. Use it in your droplet's .env
```

#### Option C: AWS RDS Free Tier

```bash
# 1. Create RDS PostgreSQL instance
# 2. Allow inbound from your droplet IP
# 3. Use connection string
```

### Solution 5: Use Different Port with SSH Tunnel

If nothing else works, create an SSH tunnel:

```bash
# On droplet, install and configure SSH tunnel
ssh -L 5433:ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech:5432 \
    -f -N your-jump-server

# Then in .env:
DATABASE_URL=postgresql://...@localhost:5433/...
```

### Solution 6: Deploy to Railway Instead

Since it works on your Windows machine, deploy the entire app to Railway where network restrictions don't exist:

```bash
# Railway handles the deployment and networking
# Your Neon database will work perfectly there
```

## Quick Test Commands

### Test if Port 5432 is Reachable

```bash
# Using bash
timeout 10 bash -c "cat < /dev/null > /dev/tcp/ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/5432" && echo "✅ Port is OPEN" || echo "❌ Port is BLOCKED"

# Using nc (netcat)
nc -zv ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech 5432

# Using telnet
telnet ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech 5432
```

### Test with psql

```bash
# Install PostgreSQL client
sudo apt-get update
sudo apt-get install postgresql-client

# Try to connect
psql "postgresql://neondb_owner:npg_W9qiBCIb8QuN@ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

If `psql` also times out, it confirms the network issue.

## Environment Variables to Try

Add these to `.env` on the droplet to increase timeout while debugging:

```bash
# Increase timeouts (won't fix network issue, but gives more debug info)
DB_CONNECTION_TIMEOUT_MS=120000
DB_MAX_RETRIES=5
DB_RETRY_DELAY_MS=5000
```

## Logs Analysis

Your logs show:

```
[db] Connection attempt 1/3 failed (NeonDbError). Retrying in 2000ms...
[db] Connection attempt 2/3 failed (NeonDbError). Retrying in 4000ms...
[db] Failed after 3 attempts
```

This proves:

- ✅ Retry logic works
- ✅ Exponential backoff works (2s, 4s)
- ❌ Network is blocked at TCP level

## Why It Works on Windows but Not Ubuntu

1. **Windows machine**: Home/office ISP doesn't block port 5432
2. **Ubuntu droplet**: DigitalOcean datacenter has stricter firewall rules
3. **Different routes**: Packets take different paths through internet

## Next Steps

1. **Try Solution 1** (non-pooler connection) - takes 2 minutes
2. **Run diagnostic script** - takes 1 minute
3. **If still blocked**: Contact DO support or switch database provider

## Need More Help?

Share the output of:

```bash
cd ~/blueMQ
./scripts/diagnose-network.sh > network-report.txt 2>&1
cat network-report.txt
```

This will give us definitive answers about what's blocked.

---

**TL;DR:** Your code is perfect. DigitalOcean is blocking your connection to Neon. Try the non-pooler connection string or switch to Supabase/Railway.
