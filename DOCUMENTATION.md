# BlueMQ Documentation

## 1. What BlueMQ Is

BlueMQ is a multi-tenant notification platform used by SaaS applications to deliver messages through:

- push
- email
- sms
- whatsapp
- call
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

- `WORKER_CHANNELS=push,email,sms,whatsapp,call,inapp`

Equivalent CLI flags are also supported:

- `--mode=all|api|worker`
- `--channels=push,email,sms,whatsapp,call,inapp`

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
- `/schedules/*`
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
- `whatsapp`:
  - MSG91 mode: `user.phone`
  - Meta mode: `user.phone` plus entity context (`entity_id` or `parent_entity_id`)
- `call`: `user.phone`
- `in_app`: no external provider identity required beyond `user_id` (mapped internally to `inapp` worker channel)

## 8. Provider Routing Rules

Provider routing is environment-driven and strict.

For each configurable channel, exactly one provider must be enabled:

```bash
PROVIDER_PUSH_ONESIGNAL=true
PROVIDER_PUSH_FIREBASE=false

PROVIDER_EMAIL_ONESIGNAL=false
PROVIDER_EMAIL_RESEND=true
PROVIDER_EMAIL_MSG91=false

PROVIDER_SMS_ONESIGNAL=true
PROVIDER_SMS_TWILIO=false
PROVIDER_SMS_MSG91=false

PROVIDER_WHATSAPP_META=true
PROVIDER_WHATSAPP_MSG91=false

PROVIDER_CALL_MSG91=true
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

If multiple variants exist for the same type/channel, BlueMQ chooses:

1. Conditional match (`condition_key` + `condition_value`) against `variables`.
2. Default variant (no condition) as fallback.

There are no built-in rule profiles or reserved condition keys. The integrating app defines the key/value pairs it wants to evaluate.

If a template for a channel is missing, BlueMQ falls back to generated content:

- `title`: `variables.title` or `type` (underscores replaced with spaces)
- `body`: `variables.body` or `variables.message` or `Notification: <type>`
- `cta_text`: `variables.cta_text` or `null`
- `cta_url`: `variables.cta_url` or request `action_url`

### 9.2 WhatsApp channel edge behavior

If `channels` includes `whatsapp` and neither `entity_id` nor `parent_entity_id` is provided:

- When WhatsApp provider resolves to Meta, BlueMQ drops `whatsapp` from delivery if other channels remain.
- For Meta-only requests, BlueMQ returns `400`.
- When WhatsApp provider resolves to MSG91, entity context is not required.

### 9.3 Push validation behavior

BlueMQ currently enforces Firebase token presence only when Firebase is active for push.

## 10. WhatsApp Providers (MSG91 and Meta)

BlueMQ supports WhatsApp through:

- MSG91 (direct send)
- Meta Cloud API (entity-session based)

Session endpoints:

- `POST /whatsapp/sessions` (create/update entity credentials)
- `GET /whatsapp/sessions` (list)
- `GET /whatsapp/sessions/:entity_id` (fetch with optional parent fallback)
- `POST /whatsapp/sessions/:entity_id/test-message`
- `DELETE /whatsapp/sessions/:entity_id` (disconnect and clear stored Meta token)

### 10.1 Meta parent fallback model

Each entity can optionally reference `parent_entity_id`.

Resolution order:

1. Active direct entity session.
2. Active parent session (if provided).
3. No active session.

Response fields indicate fallback status:

- `resolved_entity_id`
- `is_inherited`

### 10.2 WhatsApp worker semantics

- MSG91 route: sends directly using app-level MSG91 credentials.
- Meta route: resolves entity session first; missing active session is treated as non-transient failure.
- Provider/API failures are retried according to worker retry config.

## 11. Templates and Variables

Template placeholders follow `{{variable_name}}` syntax.

Example:

- Body: `Hi {{student_name}}, your fee of {{amount}} is due.`

Rendering behavior:

- Unknown placeholders remain unchanged in output.
- Optional conditional variants are supported via `condition_key` + `condition_value` on templates.
- Those condition fields are user-defined, so any product can choose its own rule names and matching values.
- CTA links can be authored directly in template `cta_url`; if omitted, notify `action_url` is used.

## 12. Notification Read APIs (Bell/Inbox)

For a tenant app, BlueMQ provides:

- `GET /notifications/:userId` (paginated, excludes soft-deleted)
- `GET /notifications/:userId/unread-count` (lightweight badge count)
- `PATCH /notifications/:notificationId/read`
- `POST /notifications/:userId/read-all`
- `DELETE /notifications/:notificationId` (soft-delete, sets `is_removed = true`)
- `GET /notifications/:notificationId/logs`

Use these to power in-app notification center and delivery diagnostics.

### 12.1 Soft Delete

The `DELETE /notifications/:notificationId` endpoint performs a soft delete by setting `is_removed = true`. The notification remains in the database for audit purposes but is excluded from all inbox queries and counts.

A `notification_deleted` WebSocket event is broadcast to connected clients.

### 12.2 Unread Count

`GET /notifications/:userId/unread-count` returns only `{ success: true, unread_count: N }`. Use this for initial badge load and after WebSocket reconnects to avoid fetching the full inbox.

## 12.5 Real-Time WebSocket

BlueMQ exposes a WebSocket server at `/ws` for real-time notification delivery.
For compatibility with API-prefixed proxies/clients, `/api/ws` is also accepted.

### Connection

Clients connect with query parameters:

```
ws://your-bluemq-host:3001/ws?api_key=<your-api-key>&user_id=<user-id>
```

If your API base URL is prefixed (for example `/api`), this alias also works:

```
ws://your-bluemq-host:3001/api/ws?api_key=<your-api-key>&user_id=<user-id>
```

For HTTPS deployments, always use `wss://`.

- `api_key`: tenant API key (same as `x-api-key` header)
- `user_id`: the user whose notifications to subscribe to

Authentication is validated on connection. Invalid keys receive a `4001` close code.

### Events

All messages are JSON with `{ event, data }` shape:

| Event                  | When                          | Data                  |
| ---------------------- | ----------------------------- | --------------------- |
| `new_notification`     | In-app notification delivered | Full notification row |
| `notification_deleted` | Notification soft-deleted     | `{ id, was_read }`    |

### Heartbeat

The server sends ping frames every 30 seconds. Clients that don't respond are terminated.

### Multi-Tenant

Connections are scoped to `appId + userId`. A broadcast to one user never reaches another app's users.

### Best Practices

- Reconnect with exponential backoff on disconnect
- Fetch `GET /notifications/:userId/unread-count` after reconnect to sync state
- Keep WS connection alive in the background (don't disconnect on tab blur)

## 12.6 Notification Retention

Notifications are retained in the database indefinitely. Client apps can implement their own retention policy by periodically calling `DELETE` on old notifications. BlueMQ recommends a 90-day retention display in the UI.

## 13. Queue and Retry Model

One queue per channel:

- `notifications-push`
- `notifications-email`
- `notifications-sms`
- `notifications-whatsapp`
- `notifications-call`
- `notifications-inapp`

Configured retries (`attempts = retries + 1`):

- push: retries `3`
- email: retries `3`
- sms: retries `5`
- whatsapp: retries `5`
- call: retries `5`
- inapp: retries `2`

Backoff policy is channel-specific and configured in `src/config/index.js`.

## 14. Data Model Summary

Core tables:

- `apps`: tenant app registry and API keys.
- `otps`: register/login OTP lifecycle.
- `templates`: per app, per type, per channel content.
- `notifications`: master notification records (`is_removed` for soft-delete).
- `notification_logs`: per-channel attempt logs.
- `whatsapp_sessions`: per-entity Meta configuration and parent fallback metadata.
- `app_provider_credentials`: per-app routing and provider credentials (Firebase, OneSignal, Resend, Twilio, MSG91).
- `app_settings`: global default configuration (poll interval, max retries, timezone).
- `client_settings`: per-client schedule setting overrides.
- `scheduled_notifications`: scheduled notification definitions (one-time and recurring).
- `schedule_execution_logs`: execution history per schedule run.

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
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- MSG91: `MSG91_AUTH_KEY`, `MSG91_WHATSAPP_NUMBER`, `MSG91_FLOW_BASE_URL`, `MSG91_SMS_FLOW_ID`, `MSG91_EMAIL_FLOW_ID`, `MSG91_CALL_FLOW_ID`
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

- If using MSG91, verify app-level MSG91 auth key + integrated number in settings.
- If using Meta, confirm active entity session in `GET /whatsapp/sessions/:entity_id`.
- If using Meta parent fallback, confirm `parent_entity_id` and parent status.
- For Meta, test directly with `POST /whatsapp/sessions/:entity_id/test-message`.

### 21.3 Call failures

- Verify `call` channel is included in notify request.
- Verify app-level/provider-level MSG91 auth key and call flow ID.
- Verify `user.phone` is present and valid.

### 21.4 Queue backlog

- Inspect `GET /health` queue counters.
- Scale worker processes for overloaded channels.
- Review Redis connectivity and mode configuration.

## 22. Scheduled Notifications

BlueMQ supports scheduled notifications that fire at specific times or on recurring schedules.

### 22.1 Schedule Types

**One-time**: Fires once at a specific future datetime, then marks itself as completed.

Example: Quiz starts at 3PM → notify enrolled students exactly at 3PM.

**Recurring**: Fires repeatedly on a defined schedule, computing `next_run_at` after each execution.

Example: Fee receipt on the 1st of every month at 9AM, attendance summary every Monday at 8AM.

Supported frequencies for recurring:
- `daily` — fires every day at `time_of_day`
- `weekly` — fires every week on `day_of_week` at `time_of_day`
- `monthly` — fires every month on `day_of_month` (capped at 28) at `time_of_day`
- `custom_cron` — fires on a custom cron expression

### 22.2 Data Source Pattern

BlueMQ does NOT store dynamic notification content. At execution time, BlueMQ calls the client's `data_source_url` to get the fresh payload. Business logic stays in the client app.

The client's `data_source_url` must respond with:

```json
{
  "notifications": [
    {
      "user_id": "uuid",
      "title": "string",
      "body": "string",
      "channels": ["push", "email", "in_app", "whatsapp"],
      "metadata": {}
    }
  ]
}
```

BlueMQ signs every outbound request with HMAC-SHA256 using the per-schedule `data_source_secret`. Headers sent:

- `x-bluemq-signature: sha256=<hmac>`
- `x-bluemq-schedule-id: <schedule_id>`
- `x-bluemq-client-id: <client_id>`
- `Content-Type: application/json`

Request body:
```json
{
  "schedule_id": "uuid",
  "client_id": "string",
  "template_key": "string",
  "triggered_at": "ISO-8601"
}
```

All outbound calls have an 8-second timeout.

### 22.3 Configuration Hierarchy

For `max_retries` and `timezone`, BlueMQ uses a 3-tier priority:

1. **Per-schedule** — values provided in the API request body
2. **Per-client** — saved in `client_settings` table via dashboard
3. **Global defaults** — stored in `app_settings` table

All config lives in the database — no env vars needed. Config can be changed at runtime without redeployment.

### 22.4 Schedule API Reference

All routes require `x-api-key`. `client_id` is always derived server-side from the API key.

| Method | Path | Description |
|--------|------|-------------|
| `POST /schedules` | Create a schedule | |
| `GET /schedules` | List schedules | `?status=` `?type=` filters |
| `GET /schedules/:id` | Get one schedule | |
| `PATCH /schedules/:id` | Update a schedule | Recomputes `next_run_at` if timing changed |
| `DELETE /schedules/:id` | Delete a schedule | |
| `POST /schedules/:id/trigger` | Manual trigger | Does not affect `next_run_at` or retry state |
| `GET /schedules/:id/logs` | Execution logs | Paginated |

**Create request body:**
```json
{
  "type": "recurring",
  "template_key": "fee_reminder",
  "data_source_url": "https://your-app.com/api/bluemq/fee-data",
  "data_source_secret": "your-hmac-secret",
  "audience": { "group": "all_students" },
  "frequency": "monthly",
  "day_of_month": 1,
  "time_of_day": "09:00",
  "timezone": "Asia/Kolkata"
}
```

Note: `data_source_secret` is write-only — it is never returned in API responses.

### 22.5 Client Settings API

| Method | Path | Description |
|--------|------|-------------|
| `GET /settings/schedule` | Get schedule settings | Returns client settings + resolved defaults |
| `PATCH /settings/schedule` | Update schedule settings | `max_retries` (1-10), `default_timezone` |

### 22.6 Polling Worker

The scheduled notification worker is a BullMQ repeatable job that:

1. Polls every N minutes (configurable via `schedule_poll_interval_cron` in `app_settings`)
2. Finds all active schedules where `next_run_at <= now()`
3. Uses `FOR UPDATE SKIP LOCKED` in a transaction to prevent duplicate processing
4. For each due schedule: calls `data_source_url`, enqueues notifications, updates state
5. On failure: increments `retry_count`; marks as `failed` when retries exhausted
6. On success: resets `retry_count`, computes next `next_run_at` for recurring schedules

The poll interval is refreshed from the database every 10 minutes without requiring a restart.

### 22.7 Log Retention

Execution logs in `schedule_execution_logs` are automatically purged after 90 days by a weekly cleanup job.

