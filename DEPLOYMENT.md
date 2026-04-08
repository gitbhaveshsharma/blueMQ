# BlueMQ — DigitalOcean Droplet Deployment Guide

This guide explains how to deploy BlueMQ on a DigitalOcean Droplet with all required services.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     DigitalOcean Droplet                         │
│                                                                   │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────────┐   │
│   │   Nginx     │────▶│   BlueMQ    │────▶│  Redis (local)  │   │
│   │  (reverse   │     │  (Node.js)  │     │  or Managed     │   │
│   │   proxy)    │     │  Port 3001  │     └─────────────────┘   │
│   │  Port 80/443│     └──────┬──────┘                           │
│   └─────────────┘            │                                   │
│                              │           ┌─────────────────┐    │
│   ┌─────────────┐            └──────────▶│  WAHA (Docker)  │    │
│   │  Certbot    │                        │  Port 3000      │    │
│   │  (SSL/TLS)  │                        └─────────────────┘    │
│   └─────────────┘                                                │
│                                                                   │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
                            ┌─────────────────────┐
                            │  Neon PostgreSQL    │
                            │  (External/Managed) │
                            └─────────────────────┘
```

## Do You Need Nginx?

**Yes, you should use Nginx for:**

1. **SSL/TLS termination** — Handle HTTPS with Let's Encrypt certificates
2. **Reverse proxy** — Route traffic to BlueMQ on port 3001
3. **Security** — Hide internal port, add rate limiting, security headers
4. **Static files** — Serve frontend assets efficiently (if deploying frontend)
5. **Load balancing** — Future-proof for multiple instances

**You could skip Nginx only if:**

- Using a managed load balancer (DigitalOcean Load Balancer)
- Testing locally / development only
- Using Cloudflare Tunnel or similar

---

## Prerequisites

- DigitalOcean account
- Domain name (recommended for SSL)
- Neon PostgreSQL database (or self-hosted PostgreSQL)

---

## Step 1: Create Droplet

### Recommended Specs

| Environment | Droplet Size | vCPU | RAM | Storage |
| ----------- | ------------ | ---- | --- | ------- |
| Development | Basic $6/mo  | 1    | 1GB | 25GB    |
| Production  | Basic $12/mo | 1    | 2GB | 50GB    |
| High Volume | Basic $24/mo | 2    | 4GB | 80GB    |

### Create Droplet

1. Go to DigitalOcean → Create → Droplets
2. Choose **Ubuntu 22.04 LTS**
3. Select size (see table above)
4. Choose datacenter region (closest to your users)
5. Add SSH key for secure access
6. Create droplet

---

## Step 2: Initial Server Setup

SSH into your droplet:

```bash
ssh root@your_droplet_ip
```

### Update system and create non-root user

```bash
# Update packages
apt update && apt upgrade -y

# Create a new user (replace 'bluemq' with your username)
adduser bluemq
usermod -aG sudo bluemq

# Copy SSH keys to new user
rsync --archive --chown=bluemq:bluemq ~/.ssh /home/bluemq

# Switch to new user
su - bluemq
```

### Configure firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Step 3: Install Required Software

### Install Node.js 20 LTS

```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # Should show v20.x.x
npm --version
```

### Install Docker (for WAHA)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add user to docker group (no sudo needed for docker commands)
sudo usermod -aG docker $USER

# Apply group changes (or log out and back in)
newgrp docker

# Verify
docker --version
```

### Install Redis

**Option A: Local Redis (simpler)**

```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify
redis-cli ping  # Should return PONG
```

**Option B: DigitalOcean Managed Redis (recommended for production)**

1. Go to DigitalOcean → Databases → Create → Redis
2. Use the connection string in your .env file

### Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Install Certbot (for SSL)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

---

## Step 4: Clone and Configure BlueMQ

### Clone repository

```bash
cd /home/bluemq
git clone https://github.com/gitbhaveshsharma/blueMQ.git
cd blueMQ
```

### Install dependencies

```bash
npm install
```

### Create environment file

```bash
cp .env.example .env
nano .env
```

Update the `.env` file:

```bash
# ─── Database (Neon PostgreSQL) ───
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# ─── Redis ───
# Local Redis:
REDIS_URL=redis://localhost:6379
# OR DigitalOcean Managed Redis:
# REDIS_URL=rediss://default:password@host:25061

# ─── OneSignal ───
ONESIGNAL_APP_ID=your_onesignal_app_id
ONESIGNAL_API_KEY=your_onesignal_api_key

# ─── WAHA (WhatsApp) ───
WAHA_BASE_URL=http://localhost:3000
WAHA_API_KEY=your_secure_random_key_here
WAHA_WEBHOOK_SECRET=your_secure_webhook_secret_here

# ─── Base URL (your domain) ───
BASE_URL=https://bluemq.yourdomain.com

# ─── Service Auth ───
SERVICE_API_KEY_SECRET=your_secure_service_secret_here

# ─── Server ───
PORT=3001
```

Generate secure keys:

```bash
# Generate random keys
openssl rand -hex 32  # Use for WAHA_API_KEY
openssl rand -hex 32  # Use for WAHA_WEBHOOK_SECRET
openssl rand -hex 32  # Use for SERVICE_API_KEY_SECRET
```

### Run database migration

```bash
npm run migrate
```

---

## Step 5: Configure WAHA (WhatsApp)

### Create WAHA environment file

```bash
cd /home/bluemq/blueMQ/waha
cp .env.example .env
nano .env
```

Update `waha/.env`:

```bash
WHATSAPP_API_KEY=same_key_as_WAHA_API_KEY_in_main_env
WHATSAPP_HOOK_URL=https://bluemq.yourdomain.com/whatsapp/sessions/webhook?secret=your_webhook_secret
WHATSAPP_HOOK_EVENTS=session.status
```

### Start WAHA with Docker

```bash
cd /home/bluemq/blueMQ/waha
docker compose up -d

# Verify
docker ps  # Should show bluemq-waha running
docker logs bluemq-waha  # Check for errors
```

---

## Step 6: Configure Nginx

### Create Nginx configuration

```bash
sudo nano /etc/nginx/sites-available/bluemq
```

Add the following configuration:

```nginx
# BlueMQ API
server {
    listen 80;
    server_name bluemq.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Rate limiting zone (define in http block of nginx.conf)
    # limit_req zone=api burst=20 nodelay;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WAHA proxy (optional - only if you need direct WAHA access)
    # Uncomment only for debugging
    # location /waha/ {
    #     proxy_pass http://127.0.0.1:3000/;
    #     proxy_http_version 1.1;
    #     proxy_set_header Host $host;
    #     proxy_set_header X-Real-IP $remote_addr;
    # }
}
```

### Enable the site

```bash
sudo ln -s /etc/nginx/sites-available/bluemq /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

### Add rate limiting (recommended)

Edit nginx.conf:

```bash
sudo nano /etc/nginx/nginx.conf
```

Add inside the `http` block:

```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_status 429;
```

---

## Step 7: Setup SSL with Let's Encrypt

```bash
sudo certbot --nginx -d bluemq.yourdomain.com
```

Follow the prompts:

1. Enter your email
2. Agree to terms
3. Choose whether to redirect HTTP to HTTPS (recommended: yes)

Certbot automatically:

- Obtains SSL certificate
- Configures Nginx for HTTPS
- Sets up auto-renewal

### Verify auto-renewal

```bash
sudo certbot renew --dry-run
```

---

## Step 8: Start BlueMQ with PM2

### Create PM2 ecosystem file

```bash
cd /home/bluemq/blueMQ
nano ecosystem.config.js
```

Add the following:

```javascript
module.exports = {
  apps: [
    {
      name: "bluemq",
      script: "src/index.js",
      cwd: "/home/bluemq/blueMQ",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      error_file: "/home/bluemq/logs/bluemq-error.log",
      out_file: "/home/bluemq/logs/bluemq-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
```

### Create logs directory

```bash
mkdir -p /home/bluemq/logs
```

### Start BlueMQ

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions to enable startup on boot
```

### Useful PM2 commands

```bash
pm2 status          # Check status
pm2 logs bluemq     # View logs
pm2 restart bluemq  # Restart
pm2 stop bluemq     # Stop
pm2 monit           # Real-time monitoring
```

---

## Step 9: Verify Deployment

### Check all services are running

```bash
# BlueMQ
pm2 status

# WAHA
docker ps

# Redis
sudo systemctl status redis-server

# Nginx
sudo systemctl status nginx
```

### Test endpoints

```bash
# Health check
curl https://bluemq.yourdomain.com/health

# Should return:
# {"status":"ok","timestamp":"...","redis":"connected","database":"connected"}
```

### Test from your app

```bash
# Register an app
curl -X POST https://bluemq.yourdomain.com/apps/register \
  -H "Content-Type: application/json" \
  -H "x-service-key: your_SERVICE_API_KEY_SECRET" \
  -d '{"app_id": "myapp", "name": "My Application"}'
```

---

## Step 10: Monitoring & Maintenance

### Setup log rotation

```bash
sudo nano /etc/logrotate.d/bluemq
```

Add:

```
/home/bluemq/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 bluemq bluemq
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Setup monitoring (optional)

**Option A: DigitalOcean Monitoring**

Enable in Droplet settings → Monitoring

**Option B: Uptime monitoring**

Use services like:

- UptimeRobot (free tier available)
- Better Uptime
- Pingdom

Monitor endpoint: `https://bluemq.yourdomain.com/health`

### Backup strategy

1. **Database**: Neon handles backups automatically
2. **WAHA sessions**: The Docker volume `waha_sessions` contains WhatsApp session data

```bash
# Backup WAHA sessions
docker run --rm -v bluemq_waha_sessions:/data -v /home/bluemq/backups:/backup \
  alpine tar czf /backup/waha-sessions-$(date +%Y%m%d).tar.gz /data
```

---

## Updating BlueMQ

```bash
cd /home/bluemq/blueMQ

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Run migrations (if any)
npm run migrate

# Restart BlueMQ
pm2 restart bluemq

# Update WAHA (if needed)
cd waha
docker compose pull
docker compose up -d
```

---

## Troubleshooting

### BlueMQ not starting

```bash
# Check logs
pm2 logs bluemq --lines 100

# Check if port is in use
sudo lsof -i :3001

# Check environment
pm2 env bluemq
```

### WAHA not connecting

```bash
# Check WAHA logs
docker logs bluemq-waha

# Restart WAHA
docker compose restart waha

# Check WAHA status
curl http://localhost:3000/api/server/status
```

### Redis connection issues

```bash
# Check Redis status
sudo systemctl status redis-server

# Test Redis
redis-cli ping

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log
```

### Nginx issues

```bash
# Check Nginx config
sudo nginx -t

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Restart Nginx
sudo systemctl restart nginx
```

### SSL certificate issues

```bash
# Renew certificate manually
sudo certbot renew

# Check certificate expiry
sudo certbot certificates
```

---

## Security Checklist

- [ ] Non-root user for running services
- [ ] UFW firewall enabled
- [ ] SSH key authentication only (disable password auth)
- [ ] SSL/TLS enabled
- [ ] Strong API keys and secrets
- [ ] Regular security updates (`sudo apt update && sudo apt upgrade`)
- [ ] Fail2ban for SSH protection (optional)
- [ ] Regular backups

---

## Quick Reference

| Service | Port    | Access               |
| ------- | ------- | -------------------- |
| Nginx   | 80, 443 | Public               |
| BlueMQ  | 3001    | Internal (via Nginx) |
| WAHA    | 3000    | Internal only        |
| Redis   | 6379    | Internal only        |

| Command                   | Description         |
| ------------------------- | ------------------- |
| `pm2 status`              | Check BlueMQ status |
| `pm2 logs bluemq`         | View BlueMQ logs    |
| `pm2 restart bluemq`      | Restart BlueMQ      |
| `docker logs bluemq-waha` | View WAHA logs      |
| `docker compose restart`  | Restart WAHA        |
| `sudo certbot renew`      | Renew SSL           |
