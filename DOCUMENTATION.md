# BlueMQ Documentation

## 1. What BlueMQ Is

BlueMQ is a multi-tenant notification platform used by SaaS applications to deliver messages through:

- push
- email
- sms
- whatsapp
- in-app

Developer implementation reference:

- TECHNICAL_IMPLEMENTATION_GUIDE.md

BlueMQ is designed so your product team can keep user-facing flows simple while BlueMQ handles delivery infrastructure, retries, logging, and provider switching.

## 2. Who Owns What (SaaS Model)

This is the most important boundary for a non-technical-friendly product.

- Your SaaS app (for example Mentoracity) owns business events, user identity mapping, and token collection.
- BlueMQ owns delivery orchestration, channel workers, provider integrations, and delivery logs.
- Coaches/end users should never need to enter technical identifiers (for example push tokens).

Practical meaning:

- Keep device token capture inside your app code (web/mobile SDK layer).
- Send those identifiers to BlueMQ from your backend/server routes.
- Do not expose BlueMQ keys or provider credentials in browser/mobile client code.

## 3. High-Level Delivery Flow

When your app calls `POST /notify`, BlueMQ performs:

1. Validate tenant auth (`x-api-key`) and payload shape.
2. Normalize channel behavior (including WhatsApp entity fallback rules).
3. Resolve template content for each requested channel.
4. Create one master row in `notifications`.
5. Enqueue one BullMQ job per channel.
6. Channel workers send via configured providers.
7. Each attempt is written to `notification_logs`.
8. `notifications.status` is updated to `delivered`, `partial`, or `failed`.

## 4. Runtime Modes and Process Isolation

BlueMQ supports process separation:

- `PROCESS_MODE=all` (default): API + workers.
- `PROCESS_MODE=api`: API only.
- `PROCESS_MODE=worker`: workers only.

Worker channel scoping:

- `WORKER_CHANNELS=push,email,sms,whatsapp,inapp`

Equivalent CLI flags are also supported:

- `--mode=all|api|worker`
- `--channels=push,email,sms,whatsapp,inapp`

Important startup behavior:

- Database migration runs in `all` and `api` mode.
- Migration does not run in `worker` mode.

## 5. Authentication and Tenant Boundaries

### 5.1 Public routes

- `GET /health`
- `POST /auth/register/send-otp`
- `POST /auth/register/verify-otp`
- `POST /auth/login/send-otp`
- `POST /auth/login/verify-otp`
- `POST /apps/register` (service-admin route via `x-service-secret`)

### 5.2 Protected routes

All routes below require `x-api-key`:

- `/notify`
- `/notifications/*`
- `/templates/*`
- `/whatsapp/*`
- `/apps/me`

`x-api-key` is mapped to a tenant in `apps`, and `req.appId` is used to scope all data.

## 6. App Onboarding Flows

### 6.1 Recommended for SaaS operators: OTP flow

1. `POST /auth/register/send-otp` with `email`, `app_name`, `app_id`.
2. `POST /auth/register/verify-otp` with `email`, `code`.
3. Receive generated `api_key`.

Login flow is similar:

1. `POST /auth/login/send-otp`.
2. `POST /auth/login/verify-otp`.

### 6.2 Service-admin flow

`POST /apps/register` exists for internal/admin usage and requires `x-service-secret`.

## 7. Channels and Required Recipient Fields

BlueMQ expects channel-specific recipient data inside `user`:

- `push` (OneSignal mode): `user.onesignal_player_id` preferred, otherwise OneSignal external user targeting is attempted.
- `push` (Firebase mode): requires one of `user.fcm_token`, `user.firebase_token`, `user.push_token`.
- `email`: `user.email`
- `sms`: `user.phone`
- `whatsapp`: `user.phone` plus entity context (`entity_id` or `parent_entity_id`)
- `in_app`: no external provider identity required beyond `user_id` (mapped internally to `inapp` worker channel)

## 8. Provider Routing Rules

Provider routing is environment-driven and strict.

For each configurable channel, exactly one provider must be enabled:

```bash
PROVIDER_PUSH_ONESIGNAL=true
PROVIDER_PUSH_FIREBASE=false

PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true

PROVIDER_SMS_ONESIGNAL=true

PROVIDER_WHATSAPP_META=true
```

Notes:

- `inapp` is always internal (`InAppProvider`).
- If a channel has zero or multiple enabled providers, startup fails.

## 9. Notify API Behavior (Business-Critical)

Endpoint:

- `POST /notify`

Minimum required fields:

- `user_id`
- `type`
- `channels` (non-empty array)
- `user` object

### 9.1 Template resolution

BlueMQ attempts to load active templates by `app_id + type + channel`.

If a template for a channel is missing, BlueMQ falls back to generated content:

- `title`: `variables.title` or `type` (underscores replaced with spaces)
- `body`: `variables.body` or `variables.message` or `Notification: <type>`
- `cta_text`: `variables.cta_text` or `null`

### 9.2 WhatsApp channel edge behavior

If `channels` includes `whatsapp` and neither `entity_id` nor `parent_entity_id` is provided:

- BlueMQ drops `whatsapp` from delivery if other channels remain.
- BlueMQ returns `400` only when WhatsApp was the only requested channel.

### 9.3 Push validation behavior

BlueMQ currently enforces Firebase token presence only when Firebase is active for push.

## 10. WhatsApp (Meta Cloud API Only)

BlueMQ supports Meta WhatsApp Cloud API only.

Session endpoints:

- `POST /whatsapp/sessions` (create/update entity credentials)
- `GET /whatsapp/sessions` (list)
- `GET /whatsapp/sessions/:entity_id` (fetch with optional parent fallback)
- `POST /whatsapp/sessions/:entity_id/test-message`
- `DELETE /whatsapp/sessions/:entity_id` (disconnect and clear stored Meta token)

### 10.1 Parent fallback model

Each entity can optionally reference `parent_entity_id`.

Resolution order:

1. Active direct entity session.
2. Active parent session (if provided).
3. No active session.

Response fields indicate fallback status:

- `resolved_entity_id`
- `is_inherited`

### 10.2 WhatsApp worker semantics

- Missing active session is treated as a non-transient failure (logged, no retry throw in that branch).
- Provider/API failures are retried according to worker retry config.

## 11. Templates and Variables

Template placeholders follow `{{variable_name}}` syntax.

Example:

- Body: `Hi {{student_name}}, your fee of {{amount}} is due.`

Rendering behavior:

- Unknown placeholders remain unchanged in output.

## 12. Notification Read APIs (Bell/Inbox)

For a tenant app, BlueMQ provides:

- `GET /notifications/:userId` (paginated)
- `PATCH /notifications/:notificationId/read`
- `POST /notifications/:userId/read-all`
- `GET /notifications/:notificationId/logs`

Use these to power in-app notification center and delivery diagnostics.

## 13. Queue and Retry Model

One queue per channel:

- `notifications-push`
- `notifications-email`
- `notifications-sms`
- `notifications-whatsapp`
- `notifications-inapp`

Configured retries (`attempts = retries + 1`):

- push: retries `3`
- email: retries `3`
- sms: retries `5`
- whatsapp: retries `5`
- inapp: retries `2`

Backoff policy is channel-specific and configured in `src/config/index.js`.

## 14. Data Model Summary

Core tables:

- `apps`: tenant app registry and API keys.
- `otps`: register/login OTP lifecycle.
- `templates`: per app, per type, per channel content.
- `notifications`: master notification records.
- `notification_logs`: per-channel attempt logs.
- `whatsapp_sessions`: per-entity Meta configuration and parent fallback metadata.

## 15. Environment Configuration

### 15.1 Core

- `PORT` (default `3001`)
- `DATABASE_URL`
- `BASE_URL`
- `SERVICE_API_KEY_SECRET`

### 15.2 Database resilience

- `DB_CONNECTION_TIMEOUT_MS`
- `DB_MAX_RETRIES`
- `DB_RETRY_DELAY_MS`

### 15.3 Redis runtime

- `REDIS_MODE=single|sentinel|cluster`
- `REDIS_URL` (single)
- `REDIS_SENTINELS`, `REDIS_SENTINEL_NAME` (sentinel)
- `REDIS_CLUSTER_NODES` (cluster)
- `REDIS_DB`
- `REDIS_TLS_ENABLED`
- `REDIS_TLS_REJECT_UNAUTHORIZED`

### 15.4 Provider credentials

- OneSignal: `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Firebase (single JSON): `FIREBASE_SERVICE_ACCOUNT_JSON`
- Firebase (split fields): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

## 16. Health and Operations

`GET /health` returns:

- service status
- provider registry snapshot
- queue depth counters (`waiting`, `active`, `completed`, `failed`, `delayed`)

Use this endpoint for dashboards and alerting.

## 17. Security Guidelines

- Never hardcode API keys, secrets, or provider tokens in source code.
- Keep BlueMQ credentials in environment variables or secret managers.
- Call BlueMQ from backend/server routes, not directly from public clients.
- Rotate service secrets and provider credentials periodically.
- Use HTTPS in production.

## 18. Deployment Notes

### 18.1 Docker/compose

Production compose includes API, Redis, Nginx, and Certbot.

### 18.2 PM2

`ecosystem.config.js` supports separate API and per-channel worker apps.

This allows scaling channels independently.

## 19. Known Implementation Notes (From Current Code Review)

These are not hypothetical; they describe current behavior.

1. Public/API canonical in-app channel is `in_app`.
2. Legacy alias `inapp` is accepted and normalized at API boundaries.
3. Worker/runtime channel key remains `inapp` internally for queue compatibility.
4. Template resolution for in-app is alias-aware (`in_app` + legacy `inapp`) and API responses are canonicalized to `in_app`.

## 20. SaaS Integration Blueprint (No Hardcoding)

Recommended architecture:

1. Your app server owns business event triggers.
2. Your app server builds BlueMQ payload from internal user profile and routing context.
3. Your app server calls BlueMQ with tenant `x-api-key` from secure environment.
4. Your app UI reads notification list from your backend proxy or directly from BlueMQ only in trusted admin tooling.

Keep these values configurable via environment variables:

- BlueMQ base URL
- BlueMQ app API key
- enabled channels per event type
- provider routing flags

Do not hardcode them per tenant inside business logic.

## 21. Quick Troubleshooting

### 21.1 Notification not delivered

- Check `GET /notifications/:notificationId/logs` (through the logs endpoint).
- Verify recipient fields in `user` for each channel.
- Verify provider credentials are configured.
- Verify workers for the channel are running.

### 21.2 WhatsApp failures

- Confirm active entity session in `GET /whatsapp/sessions/:entity_id`.
- If using parent fallback, confirm `parent_entity_id` and parent status.
- Test directly with `POST /whatsapp/sessions/:entity_id/test-message`.

### 21.3 Queue backlog

- Inspect `GET /health` queue counters.
- Scale worker processes for overloaded channels.
- Review Redis connectivity and mode configuration.
