# BlueMQ - Notification Service

Production-grade multi-channel notification service built with BullMQ, Redis, Neon (PostgreSQL), and a provider abstraction layer.

## Documentation

- Business and operator guide: DOCUMENTATION.md
- Developer integration guide: TECHNICAL_IMPLEMENTATION_GUIDE.md

## Architecture

Client App -> POST /notify -> API Layer -> BullMQ Queues -> Workers -> Providers -> Delivery

## Channels

| Channel  | Provider              | Concurrency | Retries |
| -------- | --------------------- | ----------- | ------- |
| Push     | OneSignal or Firebase | 10          | 3       |
| Email    | Resend or OneSignal   | 5           | 3       |
| SMS      | OneSignal             | 5           | 5       |
| WhatsApp | Meta Cloud API        | 5           | 5       |
| In-App   | DB (direct)           | 20          | 2       |

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Redis (local or managed)
- Neon database (free tier works)
- OneSignal account
- Meta WhatsApp Cloud API credentials

### 2. Install

```bash
npm install
```

### 3. Configure

Create `.env` and add your credentials.

Key values:

```bash
PORT=3001
DATABASE_URL=postgres://...
REDIS_URL=redis://...
BASE_URL=https://your-domain.com
SERVICE_API_KEY_SECRET=your-service-secret

# Provider routing
PROVIDER_PUSH_ONESIGNAL=true
PROVIDER_PUSH_FIREBASE=false
PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true
PROVIDER_SMS_ONESIGNAL=true
PROVIDER_WHATSAPP_META=true
```

### 4. Test database connection

```bash
npm run test:db
```

### 5. Run migrations

```bash
npm run migrate
```

### 6. Start

```bash
# Development
npm run dev

# Production
npm start
```

## Process Modes

BlueMQ supports process isolation:

- `api` mode: runs only HTTP API
- `worker` mode: runs only workers
- `all` mode: runs API + workers

Examples:

```bash
npm run start:api
npm run start:worker
npm run start:worker -- --channels=push
npm run start:worker -- --channels=whatsapp
```

## API Reference

### Health Check

```http
GET /health
```

No auth required.

### Register an App

```http
POST /apps/register
Headers: x-service-secret: <SERVICE_API_KEY_SECRET>
Body: { "app_id": "tutrsy", "name": "Tutrsy App" }
```

### Create Template

```http
POST /templates
Headers: x-api-key: <your-api-key>
Body: {
  "type": "fee_due",
  "channel": "push",
  "title": "Fee Reminder",
  "body": "Hi {{student_name}}, your fee of {{amount}} is due",
  "cta_text": "View Fee Details"
}
```

### Send Notification

```http
POST /notify
Headers: x-api-key: <your-api-key>
Body: {
  "user_id": "user_123",
  "type": "fee_due",
  "channels": ["push", "email", "whatsapp", "in_app"],
  "entity_id": "coaching_center_1",
  "variables": {
    "student_name": "Rahul",
    "amount": "5000"
  },
  "user": {
    "email": "rahul@gmail.com",
    "phone": "919876543210",
    "onesignal_player_id": "abc-123",
    "fcm_token": "fcm-device-token"
  },
  "action_url": "https://tutrsy.com/fees",
  "data": { "fee_id": "fee_456" }
}
```

Note: `entity_id` is required when `whatsapp` is in `channels`.
Push note: if push provider is Firebase, include `fcm_token` (or `firebase_token` / `push_token`) in `user`.

## WhatsApp Session Management (Meta Only)

Each entity (for example coaching center, coach, branch) has an independent Meta WhatsApp configuration.

### List Sessions

```http
GET /whatsapp/sessions
Headers: x-api-key: <your-api-key>
```

### Create or Update Session

```http
POST /whatsapp/sessions
Headers: x-api-key: <your-api-key>
Body: {
  "entity_id": "coach_1",
  "entity_name": "Coach Sharma",
  "connection_type": "meta",
  "meta_api_key": "EA...",
  "meta_phone_number_id": "123456789012345",
  "meta_business_account_id": "987654321012345"
}
```

### Get Session Status

```http
GET /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

### Send Test Message

```http
POST /whatsapp/sessions/:entity_id/test-message
Headers: x-api-key: <your-api-key>
Body: { "phone": "919876543210", "message": "Hello!" }
```

### Disconnect Session

```http
DELETE /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

## Deploy

### Railway

1. Create project
2. Add Redis plugin
3. Connect GitHub repo
4. Set environment variables
5. Deploy

### DigitalOcean Droplet

See `DEPLOYMENT.md` and `DEPLOY_DROPLET.md`.

## Folder Structure

```text
src/
├── api/
│   ├── routes/
│   └── middlewares/
├── config/
├── db/
├── providers/
├── queues/
├── workers/
└── index.js
```

## Notes

- WhatsApp delivery is Meta Cloud API only.
- BlueMQ stores per-entity Meta credentials in `whatsapp_sessions`.
- Session API key values are masked in read responses.
