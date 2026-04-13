# BlueMQ — Notification Service

Production-grade multi-channel notification service built with **BullMQ**, **Redis**, **Neon (PostgreSQL)**, and a **provider abstraction layer**.

## Architecture

```
Client App  →  POST /notify  →  API Layer  →  BullMQ Queues  →  Workers  →  Providers  →  Delivery
                                                                              ↓
                                                                         Neon DB (logs)
```

## Channels

| Channel  | Provider               | Concurrency | Retries |
| -------- | ---------------------- | ----------- | ------- |
| Push     | OneSignal or Firebase  | 10          | 3       |
| Email    | Resend or OneSignal    | 5           | 3       |
| SMS      | OneSignal              | 5           | 5       |
| WhatsApp | WAHA or Meta Cloud API | 5           | 5       |
| In-App   | DB (direct)            | 20          | 2       |

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Redis (local or Railway Redis plugin)
- Neon database (free tier works)
- OneSignal account
- WAHA Docker container (for WhatsApp — self-hosted)

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Test database connection (recommended)

```bash
npm run test:db
```

This verifies your `DATABASE_URL` is correct and the database is accessible. If it fails, see [DATABASE_CONNECTION_GUIDE.md](./DATABASE_CONNECTION_GUIDE.md).

### 5. Run migrations

```bash
npm run migrate
```

### 6. Start

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

### 7. Separate Worker Processes (Recommended)

BlueMQ now supports process modes for isolation:

- `api` mode: runs only HTTP API
- `worker` mode: runs only workers
- `all` mode: runs API + workers (default)

Run separate processes per channel:

```bash
# API only
npm run start:api

# All workers (no API)
npm run start:worker

# Single-channel worker process
npm run start:worker -- --channels=push
npm run start:worker -- --channels=whatsapp
```

Runtime options:

- `--mode=api|worker|all` (or `PROCESS_MODE` env)
- `--channels=push,email,sms,whatsapp,inapp` (or `WORKER_CHANNELS` env)

Example architecture for crash isolation:

- 1 API process: `--mode=api`
- 1 Push worker: `--mode=worker --channels=push`
- 1 Email worker: `--mode=worker --channels=email`
- 1 SMS worker: `--mode=worker --channels=sms`
- 1 WhatsApp worker: `--mode=worker --channels=whatsapp`
- 1 In-app worker: `--mode=worker --channels=inapp`

If WhatsApp worker crashes, push/email/sms workers continue running.

### 8. Redis High Availability (Sentinel / Cluster)

BlueMQ supports three Redis modes via configuration only (no code changes):

- `single`: one Redis endpoint (works with managed Redis failover endpoints)
- `sentinel`: Redis Sentinel failover setup
- `cluster`: Redis Cluster with multiple nodes

Set mode:

```bash
REDIS_MODE=single
```

#### Single Mode (Managed Redis endpoint)

Use this for DigitalOcean Managed Redis or Upstash endpoint URLs.

```bash
REDIS_MODE=single
REDIS_URL=rediss://default:password@host:25061
REDIS_TLS_ENABLED=true
REDIS_TLS_REJECT_UNAUTHORIZED=true
REDIS_DB=0
```

#### Sentinel Mode

```bash
REDIS_MODE=sentinel
REDIS_SENTINELS=10.0.0.11:26379,10.0.0.12:26379,10.0.0.13:26379
REDIS_SENTINEL_NAME=mymaster
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_SENTINEL_USERNAME=
REDIS_SENTINEL_PASSWORD=
REDIS_TLS_ENABLED=false
```

#### Cluster Mode

```bash
REDIS_MODE=cluster
REDIS_CLUSTER_NODES=10.0.0.21:6379,10.0.0.22:6379,10.0.0.23:6379
REDIS_CLUSTER_SCALE_READS=master
REDIS_CLUSTER_MAX_REDIRECTIONS=16
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_TLS_ENABLED=false
```

Common Redis options:

- `REDIS_CONNECT_TIMEOUT_MS` (default `10000`)
- `REDIS_LAZY_CONNECT` (default `false`)
- `REDIS_DB` (default `0`)

Validation rules (startup fails fast):

- Sentinel mode requires `REDIS_SENTINELS` and `REDIS_SENTINEL_NAME`
- Cluster mode requires `REDIS_CLUSTER_NODES`
- Invalid mode or malformed host:port lists are rejected at startup

## API Reference

### Health Check

```
GET /health
```

No auth required. Returns service status, provider registry, and queue stats.

### Register an App

```
POST /apps/register
Headers: x-service-secret: <SERVICE_API_KEY_SECRET>
Body: { "app_id": "tutrsy", "name": "Tutrsy App" }
Response: { "success": true, "app_id": "tutrsy", "api_key": "bmq_..." }
```

### Create Template

```
POST /templates
Headers: x-api-key: <your-api-key>
Body: {
  "type": "fee_due",
  "channel": "push",
  "title": "Fee Reminder 💰",
  "body": "Hi {{student_name}}, your fee of {{amount}} is due",
  "cta_text": "View Fee Details"
}
```

### Send Notification

```
POST /notify
Headers: x-api-key: <your-api-key>
Body: {
  "user_id": "user_123",
  "type": "fee_due",
  "channels": ["push", "email", "whatsapp", "inapp"],
  "entity_id": "coaching_center_1",
  "variables": {
    "student_name": "Rahul",
    "amount": "₹5,000"
  },
  "user": {
    "email": "rahul@gmail.com",
    "phone": "+91XXXXXXXXXX",
    "onesignal_player_id": "abc-123"
  },
  "action_url": "https://tutrsy.com/fees",
  "data": { "fee_id": "fee_456" }
}

Response (202): {
  "success": true,
  "notification_id": "uuid",
  "channels_enqueued": ["push", "email", "whatsapp", "inapp"]
}
```

> **Note:** `entity_id` is required when `whatsapp` is in `channels`. If missing, WhatsApp is silently skipped.

### Get User Notifications (Bell Icon)

```
GET /notifications/:userId?page=1&limit=20
Headers: x-api-key: <your-api-key>
```

### Mark as Read

```
PATCH /notifications/:notificationId/read
Headers: x-api-key: <your-api-key>
```

### Mark All Read

```
POST /notifications/:userId/read-all
Headers: x-api-key: <your-api-key>
```

### Get Delivery Logs

```
GET /notifications/:notificationId/logs
Headers: x-api-key: <your-api-key>
```

### WhatsApp Session Management

Each entity (e.g. coaching centre, coach, branch) gets its own independent WhatsApp session with a unique phone number.

#### WAHA Tier Compatibility

| Tier            | Sessions | First Session Name | Additional Session Names |
| --------------- | -------- | ------------------ | ------------------------ |
| **Core** (free) | 1        | `default`          | —                        |
| **Plus** (paid) | 2 – 100  | `default`          | `appSlug-entityId-N`     |
| **Pro** (paid)  | 100+     | `default`          | `appSlug-entityId-N`     |

The **first** session per app always uses the WAHA session name `"default"` (WAHA Core compatible). Additional sessions require WAHA Plus or Pro. API responses include `tier` and `tier_warning` fields.

**List All Sessions**

```
GET /whatsapp/sessions
Headers: x-api-key: <your-api-key>
Query: ?status=active  (optional filter)
Response: { "success": true, "count": 2, "tier": "plus", "tier_warning": "...", "sessions": [ ... ] }
```

**Create Session** — returns a QR code for scanning

```
POST /whatsapp/sessions
Headers: x-api-key: <your-api-key>
Body: { "entity_id": "coach_1", "entity_name": "Coach Sharma" }
Response (201): { "success": true, "session": "default", "status": "pending", "tier": "core", "qr_code": "data:image/..." }
```

**Get Session Status**

```
GET /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

**Send Test Message**

```
POST /whatsapp/sessions/:entity_id/test-message
Headers: x-api-key: <your-api-key>
Body: { "phone": "919876543210", "message": "Hello!" }
```

**Delete / Logout Session**

```
DELETE /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

**Webhook** (called by WAHA — no auth header required)

```
POST /whatsapp/sessions/webhook?secret=<WAHA_WEBHOOK_SECRET>
```

## Swapping Providers

Provider selection is now config-driven and channel-specific.

Set these env flags (exactly one `true` per configurable channel):

```bash
PROVIDER_PUSH_ONESIGNAL=false
PROVIDER_PUSH_FIREBASE=true

PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true

PROVIDER_SMS_ONESIGNAL=true
```

No worker, queue, or route changes are required when switching providers.

### Push Payload Notes

For Firebase push, include `user.fcm_token` (or `user.firebase_token`) in `/notify` payload.

## Deploy to Railway

1. Create a new Railway project
2. Add a Redis plugin (free)
3. Connect your GitHub repo
4. Set environment variables from `.env.example`
5. Deploy — Railway auto-detects `npm start`

## Deploy to DigitalOcean Droplet

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for a comprehensive guide covering:

- Initial server setup (Ubuntu 22.04)
- Node.js, Docker, Redis, Nginx installation
- SSL/TLS with Let's Encrypt
- PM2 process management
- Monitoring and maintenance

PM2 ecosystem for per-channel workers:

```bash
pm2 start ecosystem.config.js
pm2 status
```

Optional: limit worker channels PM2 should create:

```bash
# Example: only push + whatsapp workers
BLUEMQ_WORKER_CHANNELS=push,whatsapp pm2 start ecosystem.config.js
```

**Deploying updates:**

```bash
# On your droplet
cd ~/blueMQ
./scripts/deploy-droplet.sh
```

See [DEPLOY_DROPLET.md](./DEPLOY_DROPLET.md) for detailed deployment and troubleshooting steps.

## Troubleshooting

### Database Connection Issues

If you see `ETIMEDOUT` or connection failures:

1. **Test connection:** `npm run test:db`
2. **Check configuration:** Verify `DATABASE_URL` in `.env`
3. **Increase timeouts (for slow networks):**
   ```bash
   DB_CONNECTION_TIMEOUT_MS=60000
   DB_MAX_RETRIES=5
   DB_RETRY_DELAY_MS=3000
   ```
4. **See detailed guide:** [DATABASE_CONNECTION_GUIDE.md](./DATABASE_CONNECTION_GUIDE.md)

### Quick Commands

```bash
# Test database connection
npm run test:db

# Run migrations
npm run migrate

# Start development server
npm run dev

# Start production server
npm start
```

## Folder Structure

```
src/
├── api/
│   ├── routes/         → notify, notifications, templates, health, apps, whatsapp-sessions
│   └── middlewares/     → auth (api_key validation)
├── queues/
│   ├── connection.js   → shared Redis/ioredis connection
│   ├── index.js        → create all BullMQ queues
│   └── enqueue.js      → add jobs to queues
├── workers/
│   ├── base.worker.js  → shared worker logic (send → log → retry)
│   ├── push.worker.js
│   ├── email.worker.js
│   ├── sms.worker.js
│   ├── whatsapp.worker.js → custom: session lookup → WAHA send
│   └── inapp.worker.js
├── providers/
│   ├── interface.js    → INotificationProvider base class
│   ├── registry.js     → channel → provider mapping
│   ├── bootstrap.js    → wire up providers at startup
│   ├── onesignal.provider.js
│   ├── waha.provider.js → WAHA WhatsApp provider
│   └── inapp.provider.js
├── db/
│   ├── index.js        → Neon connection
│   ├── schema.sql      → DDL (includes whatsapp_sessions)
│   ├── migrate.js      → run migrations
│   └── migrations/     → incremental SQL migration files
├── utils/
│   └── template.js     → {{variable}} rendering
├── config/
│   └── index.js        → centralised config from env
└── index.js            → entry point
```
