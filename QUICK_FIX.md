# QUICK FIX - Connection Timeout on Droplet

## The Problem

Your droplet **cannot reach Neon database** due to network restrictions. The code works fine - it's a firewall/routing issue.

## Quick Fix #1 (Try This First) ⚡

SSH into your droplet and test if port 5432 is blocked:

```bash
ssh user@your-droplet-ip
timeout 5 bash -c "cat < /dev/null > /dev/tcp/ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/5432" && echo "PORT OPEN" || echo "PORT BLOCKED"
```

If it says **PORT BLOCKED**:

### Option A: Use Non-Pooler Connection String

```bash
# Edit .env on droplet
nano ~/blueMQ/.env

# Remove '-pooler' from hostname:
# OLD:
DATABASE_URL=postgresql://neondb_owner:npg_W9qiBCIb8QuN@ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

# NEW (remove '-pooler'):
DATABASE_URL=postgresql://neondb_owner:npg_W9qiBCIb8QuN@ep-cold-dream-ai6ax6lc.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

# Save and restart
pm2 restart bluemq
pm2 logs bluemq
```

### Option B: Open Firewall

```bash
sudo ufw allow out 5432/tcp
sudo ufw reload
pm2 restart bluemq
```

### Option C: Switch to Supabase (5 minutes)

1. Go to https://supabase.com and create free account
2. Create a new project
3. Go to Settings > Database > Connection string
4. Copy the connection string
5. Update droplet `.env`:

```bash
nano ~/blueMQ/.env
# Replace DATABASE_URL with Supabase connection string
```

6. Restart: `pm2 restart bluemq`

## Quick Fix #2: Deploy to Railway Instead

If droplet keeps having issues, deploy to Railway (where networking just works):

1. Push your code to GitHub
2. Go to https://railway.app
3. "New Project" > "Deploy from GitHub repo"
4. Add PostgreSQL plugin (or use your Neon URL)
5. Set environment variables
6. Deploy!

Railway doesn't have these network restrictions.

## Verify It's Working

```bash
pm2 logs bluemq --lines 20
```

Should see:

```
[migrate] Testing database connection...
[migrate] Connection test successful.  ✅
[migrate] Schema migration complete.
[server] Listening on port 3001
```

## Still Not Working?

Run diagnostics:

```bash
cd ~/blueMQ
chmod +x scripts/diagnose-network.sh
./scripts/diagnose-network.sh
```

Share the output and I'll help you further.

---

**Bottom Line:** DigitalOcean is blocking port 5432. Use non-pooler connection or switch provider.
