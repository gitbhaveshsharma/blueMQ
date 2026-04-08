# Step-by-Step Network Fix for DigitalOcean + Neon

## Step 1: Test Current Connectivity

SSH into your droplet and run these commands one by one:

```bash
# Test 1: Can you resolve the hostname?
nslookup ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech

# Test 2: Can you reach port 5432?
timeout 5 bash -c "cat < /dev/null > /dev/tcp/ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/5432" && echo "✅ PORT OPEN" || echo "❌ PORT BLOCKED"

# Test 3: Try with netcat
nc -zv ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech 5432 -w 5

# Test 4: Try with curl
curl -v --max-time 10 https://ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech
```

**Share the output of these commands with me.**

## Step 2: Check Firewall Rules

```bash
# Check UFW status
sudo ufw status verbose

# Check iptables
sudo iptables -L OUTPUT -n -v | grep -i 5432

# Check if there's a DigitalOcean Cloud Firewall
# Go to: https://cloud.digitalocean.com/networking/firewalls
# Check if your droplet has any firewalls attached
```

## Step 3: Fix Firewall (if needed)

```bash
# Allow outbound PostgreSQL
sudo ufw allow out 5432/tcp
sudo ufw allow out 5432/udp
sudo ufw reload

# Verify
sudo ufw status verbose

# Test again
timeout 5 bash -c "cat < /dev/null > /dev/tcp/ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/5432" && echo "✅ NOW WORKS" || echo "❌ STILL BLOCKED"
```

## Step 4: Try Non-Pooler Connection

Neon has two connection methods:

- **Pooler**: `-pooler` in hostname (connection pooling)
- **Direct**: without `-pooler` (direct connection)

Edit `.env` on your droplet:

```bash
cd ~/blueMQ
nano .env
```

**Change this line:**

```bash
# OLD (with -pooler):
DATABASE_URL=postgresql://neondb_owner:npg_W9qiBCIb8QuN@ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require

# NEW (without -pooler):
DATABASE_URL=postgresql://neondb_owner:npg_W9qiBCIb8QuN@ep-cold-dream-ai6ax6lc.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Test the new connection:**

```bash
# Test if direct connection works
timeout 5 bash -c "cat < /dev/null > /dev/tcp/ep-cold-dream-ai6ax6lc.c-4.us-east-1.aws.neon.tech/5432" && echo "✅ DIRECT WORKS" || echo "❌ ALSO BLOCKED"

# If it works, restart app
pm2 restart bluemq
pm2 logs bluemq --lines 30
```

## Step 5: Check DNS Resolution

Sometimes DNS fails on droplets:

```bash
# Test DNS
nslookup ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech

# If DNS is slow/failing, add Google DNS
sudo nano /etc/resolv.conf

# Add these at the top:
nameserver 8.8.8.8
nameserver 8.8.4.4

# Test again
nslookup ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech
```

## Step 6: Check DigitalOcean Cloud Firewall

1. Go to: https://cloud.digitalocean.com/networking/firewalls
2. Check if your droplet has any firewalls attached
3. If yes, add an **Outbound Rule**:
   - **Type**: Custom
   - **Protocol**: TCP
   - **Port Range**: 5432
   - **Destinations**: All IPv4, All IPv6

## Step 7: Check if Port 5432 is Blocked by ISP/Datacenter

Some DigitalOcean datacenters block port 5432. Test:

```bash
# Try connecting to a different PostgreSQL server (test server)
timeout 5 bash -c "cat < /dev/null > /dev/tcp/postgresql-test.example.com/5432" 2>/dev/null && echo "Port 5432 works" || echo "Port 5432 blocked"

# Check your droplet's region
curl -s http://169.254.169.254/metadata/v1/region
```

## Step 8: Contact DigitalOcean Support

If port 5432 is blocked at datacenter level, you need DO support to unblock it.

**Create a ticket:**

1. Go to: https://cloud.digitalocean.com/support/tickets
2. Subject: "Please unblock outbound port 5432 for PostgreSQL"
3. Message:

```
Hello,

I have a droplet that needs to connect to an external PostgreSQL database (Neon.tech)
on port 5432, but all connections timeout.

Droplet IP: [your IP]
Droplet ID: [your droplet ID]
Region: [your region]

Can you please verify if port 5432 is blocked for outbound connections
and unblock it if necessary?

Target: ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech:5432

Thank you!
```

## Step 9: Alternative - Use HTTP Tunnel (Last Resort)

If port 5432 is permanently blocked, you can tunnel through HTTPS:

```bash
# Install cloudflared (Cloudflare tunnel)
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Create tunnel (will run on different port)
cloudflared access tcp --hostname localhost --url ep-cold-dream-ai6ax6lc-pooler.c-4.us-east-1.aws.neon.tech:5432
```

## What You Should Do Now

Run **Step 1** (test connectivity) and **share the output**. This will tell us exactly what's blocked.

Then we'll fix it step by step!
