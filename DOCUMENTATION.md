# BlueMQ Documentation

## 1. Overview

BlueMQ is a multi-tenant notification backend that supports push, email, sms, in-app, and WhatsApp delivery.

WhatsApp is implemented with Meta WhatsApp Cloud API only.

## 2. High-Level Flow

1. Client calls `POST /notify`
2. BlueMQ validates app key and payload
3. BlueMQ writes a master `notifications` row
4. BlueMQ renders per-channel content from templates
5. BlueMQ enqueues jobs in BullMQ queues
6. Channel workers execute and write `notification_logs`

## 3. Runtime Modes

BlueMQ supports process isolation.

- `--mode=api`: API only
- `--mode=worker`: workers only
- `--mode=all`: API + workers

Optional worker scoping:

- `--channels=push,email,sms,whatsapp,inapp`

## 4. Configuration

### Core

- `PORT` (default `3001`)
- `DATABASE_URL`
- `BASE_URL`
- `SERVICE_API_KEY_SECRET`

### Redis

- `REDIS_MODE=single|sentinel|cluster`
- `REDIS_URL` (single mode)
- `REDIS_TLS_ENABLED`
- `REDIS_DB`

### Provider routing flags

Exactly one provider must be enabled per configurable channel.

```bash
PROVIDER_PUSH_ONESIGNAL=true
PROVIDER_PUSH_FIREBASE=false

PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true

PROVIDER_SMS_ONESIGNAL=true

PROVIDER_WHATSAPP_META=true
```

## 5. Data Model

### apps

App registry and API keys.

### templates

Per app + type + channel template content.

### notifications

Master record for every notification request.

### notification_logs

Per-channel attempt logs with status and provider message id.

### whatsapp_sessions

Per-entity Meta WhatsApp configuration with optional parent fallback.

Key columns:

- `app_id`, `entity_id`
- `parent_entity_id` (optional parent entity used when the child has no active credentials)
- `waha_session` (legacy column retained as generic session identifier)
- `status` (`active|pending|disconnected`)
- `connection_type` (enforced to `meta`)
- `meta_api_key`
- `meta_phone_number_id`
- `meta_business_account_id`

## 6. API Endpoints

## 6.1 Health

```http
GET /health
```

Returns:

- service status
- provider registry snapshot
- queue job counts

## 6.2 App Registration

```http
POST /apps/register
Headers: x-service-secret: <SERVICE_API_KEY_SECRET>
Body: { "app_id": "myapp", "name": "My App" }
```

## 6.3 Templates

```http
POST /templates
GET /templates
PUT /templates/:id
DELETE /templates/:id
Headers: x-api-key: <app-api-key>
```

## 6.4 Notifications

```http
POST /notify
Headers: x-api-key: <app-api-key>
```

Important WhatsApp rule:

- if `channels` contains `whatsapp`, provide `entity_id` or `parent_entity_id`.

## 6.5 Notification Reads

```http
GET /notifications/:userId
PATCH /notifications/:notificationId/read
POST /notifications/:userId/read-all
GET /notifications/:notificationId/logs
Headers: x-api-key: <app-api-key>
```

## 6.6 WhatsApp Sessions (Meta)

### List

```http
GET /whatsapp/sessions
Headers: x-api-key: <app-api-key>
```

### Create or update

```http
POST /whatsapp/sessions
Headers: x-api-key: <app-api-key>
Body: {
  "entity_id": "branch_1",
  "parent_entity_id": "center_1",
  "entity_name": "Main Branch",
  "connection_type": "meta",
  "meta_api_key": "EA...",
  "meta_phone_number_id": "123456789012345",
  "meta_business_account_id": "987654321012345"
}
```

### Fetch one

```http
GET /whatsapp/sessions/:entity_id
Headers: x-api-key: <app-api-key>
```

`meta_api_key` is masked in responses.
If a child entity has no active session, pass `?parent_entity_id=...` to resolve the parent fallback.
Responses include `resolved_entity_id` and `is_inherited` so clients can tell when a parent session is being used.

### Send test message

```http
POST /whatsapp/sessions/:entity_id/test-message
Headers: x-api-key: <app-api-key>
Body: {
  "phone": "919876543210",
  "message": "Hello",
  "parent_entity_id": "center_1"
}
```

### Disconnect

```http
DELETE /whatsapp/sessions/:entity_id
Headers: x-api-key: <app-api-key>
```

## 7. Worker Behavior

### Common behavior

- workers read queue jobs
- call provider APIs
- write attempt rows in `notification_logs`
- update `notifications.status` based on aggregate result

### WhatsApp worker

- resolves active session by `(app_id, entity_id)` and falls back to the parent entity when needed
- enforces `connection_type = meta`
- sends via `MetaWhatsAppProvider`
- logs `meta-whatsapp` as provider

## 8. Meta WhatsApp Provider

The provider sends messages via:

- `POST https://graph.facebook.com/v19.0/{phone_number_id}/messages`

Provider validations:

- requires `meta_api_key`
- requires `meta_phone_number_id`
- requires recipient phone number

Error mapping includes:

- auth failures
- recipient not on WhatsApp
- re-engagement windows
- rate limiting
- connectivity errors

## 9. Deployment Notes

## 9.1 Docker Compose

`docker-compose.production.yml` includes:

- BlueMQ API
- Redis
- Nginx
- Certbot

No WAHA container is required.

## 9.2 PM2

Use channel-isolated workers for crash isolation.

Example:

```bash
pm2 start ecosystem.config.js
```

## 10. Troubleshooting

### Database

- run `npm run test:db`
- verify `DATABASE_URL`
- adjust `DB_CONNECTION_TIMEOUT_MS`, `DB_MAX_RETRIES`, `DB_RETRY_DELAY_MS`

### WhatsApp (Meta)

- verify entity has active session in `/whatsapp/sessions/:entity_id`
- verify `meta_phone_number_id` is correct
- verify access token is valid and not expired
- use `/whatsapp/sessions/:entity_id/test-message` for direct validation

### Queue backlog

- inspect `/health` queue counts
- scale worker processes by channel

## 11. Security Guidelines

- never commit live Meta API tokens
- rotate Meta credentials periodically
- use HTTPS in production
- keep `SERVICE_API_KEY_SECRET` private
- clear credentials on session disconnect when required by policy
