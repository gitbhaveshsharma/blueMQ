# BlueMQ — Notification Service

Production-grade multi-channel notification service built with **BullMQ**, **Redis**, **Neon (PostgreSQL)**, and a **provider abstraction layer**.

## Architecture

```
Client App  →  POST /notify  →  API Layer  →  BullMQ Queues  →  Workers  →  Providers  →  Delivery
                                                                              ↓
                                                                         Neon DB (logs)
```

### Channels

| Channel  | Provider         | Concurrency | Retries |
| -------- | ---------------- | ----------- | ------- |
| Push     | OneSignal        | 10          | 3       |
| Email    | OneSignal        | 5           | 3       |
| SMS      | OneSignal        | 5           | 5       |
| WhatsApp | WAHA (self-host) | 5           | 5       |
| In-App   | DB (direct)      | 20          | 2       |

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

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

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

**Create Session** — returns a QR code for scanning

```
POST /whatsapp/sessions
Headers: x-api-key: <your-api-key>
Body: { "entity_id": "coaching_center_1" }
Response (201): { "success": true, "session": "...", "status": "pending", "qr_code": "data:image/..." }
```

**Get Session Status**

```
GET /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
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

1. Create a new provider extending `INotificationProvider`
2. Import it in `src/providers/bootstrap.js`
3. Change one line: `registry.register('push', new FCMProvider())`
4. Zero changes to workers, queues, or routes

## Deploy to Railway

1. Create a new Railway project
2. Add a Redis plugin (free)
3. Connect your GitHub repo
4. Set environment variables from `.env.example`
5. Deploy — Railway auto-detects `npm start`

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
