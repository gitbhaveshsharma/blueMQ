# BlueMQ - DigitalOcean Droplet Deployment Guide

This guide deploys BlueMQ on a DigitalOcean Droplet with a Meta-only WhatsApp setup.

## Architecture

- Nginx as reverse proxy and TLS terminator
- BlueMQ API and workers via PM2
- Redis for BullMQ
- Neon PostgreSQL (or compatible Postgres)
- Meta WhatsApp Cloud API as external provider

## Prerequisites

- Ubuntu 22.04 droplet
- Domain pointing to droplet IP
- Neon/Postgres connection string
- Redis (local or managed)
- Meta WhatsApp Cloud API credentials per entity

## 1) Base Server Setup

```bash
ssh root@your_droplet_ip
apt update && apt upgrade -y
adduser bluemq
usermod -aG sudo bluemq
rsync --archive --chown=bluemq:bluemq ~/.ssh /home/bluemq
su - bluemq
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 2) Install Runtime Dependencies

Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Redis (local option):

```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping
```

Nginx + Certbot + PM2:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

## 3) Clone and Configure BlueMQ

```bash
cd /home/bluemq
git clone https://github.com/gitbhaveshsharma/blueMQ.git
cd blueMQ
npm install
cp .env.example .env
```

Edit `.env` with production values:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
REDIS_MODE=single
REDIS_URL=redis://localhost:6379

ONESIGNAL_APP_ID=...
ONESIGNAL_API_KEY=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=BlueMQ <noreply@example.com>

PROVIDER_PUSH_ONESIGNAL=true
PROVIDER_PUSH_FIREBASE=false
PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true
PROVIDER_SMS_ONESIGNAL=true
PROVIDER_WHATSAPP_META=true

BASE_URL=https://bluemq.yourdomain.com
SERVICE_API_KEY_SECRET=replace_with_strong_secret
PORT=3001
```

Generate a strong service secret:

```bash
openssl rand -hex 32
```

Run migrations:

```bash
npm run migrate
```

## 4) Configure PM2

Use the existing ecosystem file in this repository:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs bluemq
pm2 restart bluemq
```

## 5) Configure Nginx

Create site config:

```bash
sudo nano /etc/nginx/sites-available/bluemq
```

Example config:

```nginx
server {
    listen 80;
    server_name bluemq.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/bluemq /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6) Enable TLS

```bash
sudo certbot --nginx -d bluemq.yourdomain.com
sudo certbot renew --dry-run
```

## 7) Verify Deployment

```bash
curl -sS https://bluemq.yourdomain.com/health
```

Expected:

- `status: ok`
- queue stats present
- provider registry present

Register an app:

```bash
curl -X POST https://bluemq.yourdomain.com/apps/register \
  -H "Content-Type: application/json" \
  -H "x-service-secret: YOUR_SERVICE_API_KEY_SECRET" \
  -d '{"app_id":"myapp","name":"My Application"}'
```

## 8) Configure WhatsApp Sessions (Meta)

BlueMQ stores Meta credentials per entity in `whatsapp_sessions`.

Create or update a session:

```bash
curl -X POST https://bluemq.yourdomain.com/whatsapp/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_APP_API_KEY" \
  -d '{
    "entity_id":"coach_1",
    "entity_name":"Coach Sharma",
    "connection_type":"meta",
    "meta_api_key":"EA...",
    "meta_phone_number_id":"123456789012345",
    "meta_business_account_id":"987654321012345"
  }'
```

Test message:

```bash
curl -X POST https://bluemq.yourdomain.com/whatsapp/sessions/coach_1/test-message \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_APP_API_KEY" \
  -d '{"phone":"919876543210","message":"Hello from BlueMQ"}'
```

## 9) Update Procedure

```bash
cd /home/bluemq/blueMQ
git pull origin main
npm install
npm run migrate
pm2 restart ecosystem.config.js
```

## 10) Troubleshooting

BlueMQ issues:

```bash
pm2 logs bluemq --lines 200
pm2 env bluemq
sudo lsof -i :3001
```

Redis issues:

```bash
sudo systemctl status redis-server
redis-cli ping
sudo tail -f /var/log/redis/redis-server.log
```

Nginx issues:

```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
sudo systemctl restart nginx
```

Meta WhatsApp issues:

- Verify `meta_api_key` is valid and unexpired.
- Verify `meta_phone_number_id` belongs to your WhatsApp app.
- Verify destination number is on WhatsApp and in valid international format.
- Re-test via `/whatsapp/sessions/:entity_id/test-message`.

## Security Checklist

- Run app as non-root user
- Keep UFW enabled
- Enforce TLS
- Rotate `SERVICE_API_KEY_SECRET`
- Do not commit live Meta API keys
- Monitor health endpoint

## Ports

- 80/443: Nginx (public)
- 3001: BlueMQ (internal behind Nginx)
- 6379: Redis (internal)
