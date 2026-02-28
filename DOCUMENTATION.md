# BlueMQ — Complete Integration & Developer Documentation

> **Version:** 1.0.0  
> **Stack:** Node.js · Express · BullMQ · Redis · Neon (PostgreSQL)  
> **Channels:** Push · Email · SMS · WhatsApp · In-App

---

## Table of Contents

1. [What is BlueMQ?](#1-what-is-bluemq)
2. [How It Works — The Big Picture](#2-how-it-works--the-big-picture)
3. [Architecture Deep Dive](#3-architecture-deep-dive)
4. [Self-Hosting Setup](#4-self-hosting-setup)
5. [Environment Variables Reference](#5-environment-variables-reference)
6. [Authentication Model](#6-authentication-model)
7. [Complete API Reference](#7-complete-api-reference)
   - [Health Check](#71-health-check)
   - [Register an App](#72-register-an-app)
   - [Templates](#73-templates)
   - [Send a Notification](#74-send-a-notification)
   - [Fetch User Notifications (Bell Icon)](#75-fetch-user-notifications-bell-icon)
   - [Mark as Read](#76-mark-as-read)
   - [Mark All as Read](#77-mark-all-as-read)
   - [Delivery Logs](#78-delivery-logs)
   - [WhatsApp Session Management](#77-whatsapp-session-management)
8. [Template System](#8-template-system)
9. [Notification Channels Explained](#9-notification-channels-explained)
10. [Multi-Tenant Model](#10-multi-tenant-model)
11. [Queue & Retry Behaviour](#11-queue--retry-behaviour)
12. [Provider System & Extensibility](#12-provider-system--extensibility)
13. [Database Schema](#13-database-schema)
14. [Notification Status Lifecycle](#14-notification-status-lifecycle)
15. [Step-by-Step Integration Guide](#15-step-by-step-integration-guide)
16. [Code Examples](#16-code-examples)
17. [Error Handling Reference](#17-error-handling-reference)
18. [Adding a Custom Provider](#18-adding-a-custom-provider)
19. [Next.js Integration Guide](#19-nextjs-integration-guide)
    - [Architecture in a Next.js App](#191-architecture-in-a-nextjs-app)
    - [Environment Setup](#192-environment-setup)
    - [BlueMQ Server-Side Client](#193-bluemq-server-side-client)
    - [Sending Notifications from Server Actions](#194-sending-notifications-from-server-actions)
    - [Sending Notifications from API Routes](#195-sending-notifications-from-api-routes)
    - [useNotifications Hook](#196-usenotifications-hook)
    - [Bell Icon Component](#197-bell-icon-component)
    - [Notification Dropdown Panel](#198-notification-dropdown-panel)
    - [Registering OneSignal Push (Mobile/Web)](#199-registering-onesignal-push-mobileweb)
    - [Template Management from Next.js Admin](#1910-template-management-from-nextjs-admin)

---

## 1. What is BlueMQ?

BlueMQ is a **self-hosted, multi-channel notification service** you deploy once and then call from any of your applications via a simple HTTP API.

Instead of wiring every app directly to OneSignal, WAHA, Twilio, etc., your apps talk only to BlueMQ. BlueMQ handles:

- **Queueing** — jobs are never lost even if a provider is temporarily down.
- **Retries with back-off** — automatic retry with exponential or fixed delays.
- **Template management** — store message templates in the database; inject variables at send time.
- **Multi-tenancy** — one BlueMQ instance can serve multiple apps with isolated data and API keys.
- **Delivery logging** — every send attempt (success or failure) is recorded with a provider message ID.
- **In-app inbox** — the `inapp` channel writes directly to the database; your frontend polls it for a bell-icon feed.

---

## 2. How It Works — The Big Picture

```
Your App
   │
   │  POST /notify  (x-api-key: bmq_...)
   ▼
┌──────────────────────────────────┐
│          BlueMQ API              │
│  1. Validate request             │
│  2. Fetch & render template      │
│  3. Save notification to DB      │
│  4. Enqueue jobs per channel     │
│  5. Return 202 + notification_id │
└──────────────┬───────────────────┘
               │  (async, BullMQ)
    ┌──────────┼───────────────────┐
    ▼          ▼                   ▼
 Push        Email            WhatsApp
 Queue       Queue            Queue
    │          │                   │
    ▼          ▼                   ▼
 Push       Email             WhatsApp
 Worker     Worker            Worker
    │          │                   │
    ▼          ▼                   ▼
OneSignal  OneSignal           WAHA (self-hosted)
    │          │                   │
    └──────────┴─────────┬─────────┘
                         ▼
               notification_logs (Neon DB)
               notifications.status updated
```

**Key points:**

- Your app gets an immediate `202 Accepted` response. Delivery happens asynchronously.
- Each channel runs in its own queue and worker, so a slow WhatsApp provider never delays a push notification.
- Every delivery attempt is stored in `notification_logs` for debugging.

---

## 3. Architecture Deep Dive

### 3.1 Layer Breakdown

| Layer               | Files                         | Responsibility                                          |
| ------------------- | ----------------------------- | ------------------------------------------------------- |
| **Entry Point**     | `src/index.js`                | Bootstraps DB, providers, queues, workers, Express app  |
| **Config**          | `src/config/index.js`         | Centralises all env vars and queue/worker settings      |
| **API Routes**      | `src/api/routes/`             | HTTP handler for each endpoint                          |
| **Auth Middleware** | `src/api/middlewares/auth.js` | Validates `x-api-key` and attaches `req.appId`          |
| **Database**        | `src/db/`                     | Neon (PostgreSQL) client + schema migration             |
| **Queues**          | `src/queues/`                 | BullMQ queue creation, Redis connection, enqueue helper |
| **Workers**         | `src/workers/`                | One worker per channel; calls providers, logs results   |
| **Providers**       | `src/providers/`              | Third-party API wrappers (OneSignal, WAHA, InApp)       |
| **Utilities**       | `src/utils/template.js`       | `{{variable}}` template rendering                       |

### 3.2 Startup Sequence

When `npm start` runs, `src/index.js` executes these steps in order:

1. **`migrate()`** — runs `schema.sql` against Neon (idempotent, safe to run on every boot).
2. **`bootstrapProviders()`** — instantiates OneSignal, WAHA, and InApp providers and registers them in the provider registry.
3. **`createQueues()`** — creates one BullMQ `Queue` per channel, backed by Redis.
4. **`startAllWorkers()`** — creates one BullMQ `Worker` per channel that processes jobs from their respective queues.
5. **Express app** — mounts routes and starts listening on `PORT` (default `3001`).

### 3.3 Request Flow for `POST /notify`

```
Request arrives
      │
      ├─ Auth middleware: look up x-api-key in apps table → attach req.appId
      │
      └─ notify.js handler:
            │
            ├─ Validate: user_id, type, channels, user object
            │
            ├─ Fetch templates from DB (for requested channels)
            │    └─ renderTemplate("Hi {{name}}", { name: "Rahul" }) → "Hi Rahul"
            │
            ├─ INSERT into notifications (status = 'pending')
            │
            ├─ For each channel:
            │    └─ queue.add(jobName, jobPayload, { jobId: dedupe key })
            │
            └─ Return 202 { notification_id, channels_enqueued }
```

### 3.4 Worker Processing Flow

Each worker (`push`, `email`, `sms`, `whatsapp`, `inapp`) does this for every job:

```
Pick job from queue
      │
      ├─ Call registry.send(channel, payload)
      │     → calls primary provider's method (sendPush, sendEmail, etc.)
      │     → if NotSupportedError → tries fallback provider
      │
      ├─ On SUCCESS:
      │     ├─ INSERT into notification_logs (status = 'sent')
      │     └─ UPDATE notifications.status → 'delivered' (or 'partial' if some channels failed)
      │
      └─ On FAILURE:
            ├─ INSERT into notification_logs (status = 'failed')
            ├─ Throw error → BullMQ auto-retries with configured back-off
            └─ After all retries exhausted:
                  ├─ INSERT notification_logs (status = 'permanently_failed')
                  └─ UPDATE notifications.status → 'failed'
```

---

## 4. Self-Hosting Setup

### Prerequisites

| Requirement       | Notes                                                  |
| ----------------- | ------------------------------------------------------ |
| Node.js 18+       | LTS recommended                                        |
| Redis             | Local, Railway Redis plugin, or any Redis host         |
| Neon PostgreSQL   | Free tier at [neon.tech](https://neon.tech) works fine |
| OneSignal account | For Push, Email, SMS channels                          |
| WAHA container    | Self-hosted WhatsApp Web automation (Docker)           |

### Step 1 — Clone and install

```bash
git clone https://github.com/gitbhaveshsharma/blueMQ.git
cd blueMQ
npm install
```

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Section 5](#5-environment-variables-reference) for the full list).

### Step 3 — Run database migration

```bash
npm run migrate
```

This creates five tables in your Neon database: `apps`, `templates`, `notifications`, `notification_logs`, `whatsapp_sessions`. It is safe to run multiple times.

### Step 4 — Start the service

```bash
# Development (auto-reload with nodemon)
npm run dev

# Production
npm start
```

You should see:

```
═══════════════════════════════════════════
  BlueMQ — Notification Service
═══════════════════════════════════════════
[migrate] Running schema migration...
[migrate] Schema migration complete.
[providers] Registry initialised: {"push":"onesignal","email":"onesignal",...}
[queues] Created queue: bluemq:push (retries=3)
[queues] Created queue: bluemq:email (retries=3)
...
[workers] All 5 workers started
[redis] Connected
[server] Listening on port 3001
```

---

## 5. Environment Variables Reference

Create a `.env` file at the project root with the following variables:

```env
# ─── Server ───────────────────────────────────────
PORT=3001

# ─── Neon PostgreSQL ──────────────────────────────
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# ─── Redis (BullMQ) ───────────────────────────────
REDIS_URL=redis://localhost:6379
# For Railway: redis://default:password@host:port

# ─── OneSignal (Push, Email, SMS) ─────────────────
ONESIGNAL_APP_ID=your-onesignal-app-id
ONESIGNAL_API_KEY=your-onesignal-rest-api-key

# ─── WAHA (WhatsApp — self-hosted) ────────────────
WAHA_BASE_URL=http://waha.railway.internal:3000
WAHA_API_KEY=your-waha-api-key
WAHA_WEBHOOK_SECRET=a-random-webhook-secret

# ─── Base URL (for webhook configs) ───────────────
BASE_URL=https://your-bluemq-domain.com

# ─── Service Admin Secret ─────────────────────────
# Used ONLY for POST /apps/register — keep this private
SERVICE_API_KEY_SECRET=a-long-random-secret-string
```

| Variable                 | Required                 | Description                                                                             |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------- |
| `PORT`                   | No                       | HTTP port. Default: `3001`                                                              |
| `DATABASE_URL`           | **Yes**                  | Neon connection string with `?sslmode=require`                                          |
| `REDIS_URL`              | No                       | Redis URL. Default: `redis://localhost:6379`                                            |
| `ONESIGNAL_APP_ID`       | Yes (for push/email/sms) | Found in your OneSignal dashboard                                                       |
| `ONESIGNAL_API_KEY`      | Yes (for push/email/sms) | REST API Key from OneSignal                                                             |
| `WAHA_BASE_URL`          | Yes (for WhatsApp)       | WAHA container URL. Default: `http://localhost:3000`                                    |
| `WAHA_API_KEY`           | Yes (for WhatsApp)       | API key configured in your WAHA instance                                                |
| `WAHA_WEBHOOK_SECRET`    | Recommended              | Secret appended as `?secret=` to webhook URL for validation                             |
| `BASE_URL`               | Recommended              | Public URL of your BlueMQ instance (used for WAHA webhook registration)                 |
| `SERVICE_API_KEY_SECRET` | **Yes**                  | Admin secret for registering new apps. Default: `dev-secret` — **change in production** |

---

## 6. Authentication Model

BlueMQ uses a **two-level auth system**:

### Level 1 — Service Admin Secret (`x-service-secret`)

Used **only** for `POST /apps/register`. This is a shared secret between you (the BlueMQ operator) and any tooling / CI that provisions new client apps. Never expose this to end users.

```
Header: x-service-secret: <SERVICE_API_KEY_SECRET>
```

### Level 2 — App API Key (`x-api-key`)

Every app registered with BlueMQ receives a unique API key prefixed with `bmq_`. This key is stored (hashed to the app) in the `apps` table.

All protected routes (`/notify`, `/notifications`, `/templates`) require:

```
Header: x-api-key: bmq_<64 hex chars>
```

The auth middleware (`src/api/middlewares/auth.js`) performs a database lookup on every request and attaches `req.appId` and `req.appName` for the route handler.

**Data isolation:** every DB query in protected routes is scoped to `req.appId`, so two apps registered on the same BlueMQ instance can never see each other's notifications or templates.

---

## 7. Complete API Reference

### 7.1 Health Check

```
GET /health
```

**Auth:** None  
**Use:** Uptime checks, Railway health probes, debugging provider status.

**Response `200`:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-28T10:00:00.000Z",
  "providers": {
    "push": "onesignal",
    "email": "onesignal",
    "sms": "onesignal",
    "whatsapp": "waha",
    "inapp": "inapp"
  },
  "queues": {
    "push": {
      "waiting": 0,
      "active": 1,
      "completed": 142,
      "failed": 2,
      "delayed": 0
    },
    "email": {
      "waiting": 0,
      "active": 0,
      "completed": 85,
      "failed": 0,
      "delayed": 0
    },
    "sms": {
      "waiting": 3,
      "active": 1,
      "completed": 60,
      "failed": 1,
      "delayed": 0
    },
    "whatsapp": {
      "waiting": 0,
      "active": 0,
      "completed": 20,
      "failed": 0,
      "delayed": 0
    },
    "inapp": {
      "waiting": 0,
      "active": 0,
      "completed": 210,
      "failed": 0,
      "delayed": 0
    }
  }
}
```

---

### 7.2 Register an App

```
POST /apps/register
```

**Auth:** `x-service-secret` header (admin only)  
**Use:** Create a new tenant app. Run this once per app during onboarding.

**Request body:**

```json
{
  "app_id": "tutrsy",
  "name": "Tutrsy App"
}
```

| Field    | Type   | Required | Description                                                                |
| -------- | ------ | -------- | -------------------------------------------------------------------------- |
| `app_id` | string | Yes      | A short, unique, URL-safe identifier for your app (e.g. `tutrsy`, `myapp`) |
| `name`   | string | Yes      | Human-readable app name                                                    |

**Response `201`:**

```json
{
  "success": true,
  "app_id": "tutrsy",
  "api_key": "bmq_a3f7...long key...c9d2"
}
```

> **Important:** Store `api_key` securely. It is shown only once. If lost, re-register to overwrite (existing key is replaced).

---

### 7.3 Templates

Templates are per-app, per-type, per-channel. They support `{{variable}}` placeholders that get substituted at send time.

#### Create / Update a Template

```
POST /templates
```

**Auth:** `x-api-key`

**Request body:**

```json
{
  "type": "fee_due",
  "channel": "push",
  "title": "Fee Reminder 💰",
  "body": "Hi {{student_name}}, your fee of ₹{{amount}} is due on {{due_date}}.",
  "cta_text": "Pay Now"
}
```

| Field      | Type   | Required | Description                                                                                            |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `type`     | string | Yes      | Template type identifier. Convention: `snake_case` (e.g. `fee_due`, `class_reminder`, `order_shipped`) |
| `channel`  | string | Yes      | One of: `push`, `email`, `sms`, `whatsapp`, `in_app`                                                   |
| `title`    | string | No       | Subject / heading. Used by push and email.                                                             |
| `body`     | string | Yes      | Message body. Supports `{{variable}}` placeholders.                                                    |
| `cta_text` | string | No       | Call-to-action button text.                                                                            |

If a template for the same `(app_id, type, channel)` combination already exists, it is **updated** (upsert behaviour).

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "app_id": "tutrsy",
    "type": "fee_due",
    "channel": "push",
    "title": "Fee Reminder 💰",
    "body": "Hi {{student_name}}, your fee of ₹{{amount}} is due on {{due_date}}.",
    "cta_text": "Pay Now",
    "is_active": true,
    "created_at": "2026-02-28T10:00:00Z",
    "updated_at": "2026-02-28T10:00:00Z"
  }
}
```

#### List Templates

```
GET /templates
GET /templates?type=fee_due
GET /templates?type=fee_due&channel=push
```

**Auth:** `x-api-key`

Returns all templates for the authenticated app, optionally filtered by `type` and/or `channel`.

#### Update a Template

```
PUT /templates/:id
```

**Auth:** `x-api-key`

Pass only the fields you want to change:

```json
{
  "body": "Updated body text",
  "is_active": false
}
```

| Field       | Description                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `title`     | Update the title                                                                                        |
| `body`      | Update the body                                                                                         |
| `cta_text`  | Update the CTA text                                                                                     |
| `is_active` | `false` disables this template (notifications for this type/channel will use the fallback generic body) |

#### Delete a Template

```
DELETE /templates/:id
```

**Auth:** `x-api-key`

Permanently deletes the template. Future notifications of that type to that channel will use a fallback generic body.

---

### 7.4 Send a Notification

This is the **main endpoint** your application calls when you want to notify a user.

```
POST /notify
```

**Auth:** `x-api-key`  
**Returns:** `202 Accepted` immediately. Delivery is asynchronous.

**Request body:**

```json
{
  "user_id": "user_123",
  "type": "fee_due",
  "channels": ["push", "email", "whatsapp", "inapp"],
  "entity_id": "coaching_center_1",
  "variables": {
    "student_name": "Rahul Sharma",
    "amount": "5000",
    "due_date": "March 5, 2026"
  },
  "user": {
    "email": "rahul@example.com",
    "phone": "+919876543210",
    "onesignal_player_id": "abc-123-def-456"
  },
  "action_url": "https://tutrsy.com/fees",
  "data": {
    "fee_id": "fee_789"
  }
}
```

| Field        | Type     | Required | Description                                                                                                                                   |
| ------------ | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`    | string   | **Yes**  | Your application's user identifier. Used to scope the in-app inbox. Can be any string — UUID, integer, email, etc.                            |
| `type`       | string   | **Yes**  | The notification type. Must match a registered template type, or a generic fallback will be used.                                             |
| `channels`   | string[] | **Yes**  | Non-empty array of channels to send to. Valid values: `push`, `email`, `sms`, `whatsapp`, `inapp`.                                            |
| `variables`  | object   | No       | Key/value pairs to inject into `{{variable}}` placeholders in the template.                                                                   |
| `user`       | object   | **Yes**  | Delivery addresses. See table below.                                                                                                          |
| `action_url` | string   | No       | Deep-link URL opened when the user taps a push notification or the in-app item.                                                               |
| `data`       | object   | No       | Arbitrary extra payload attached to the notification (stored as JSONB). Useful for passing context — e.g. `{ "fee_id": "fee_789" }`.          |
| `entity_id`  | string   | WhatsApp | Required when `whatsapp` is in `channels`. Identifies the entity whose WAHA session should be used. If missing, WhatsApp is silently skipped. |

**`user` object fields:**

| Field                 | Required for       | Description                                                                                        |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `onesignal_player_id` | `push` (preferred) | OneSignal device player ID for targeted push. Falls back to `external_user_id` tagging if missing. |
| `email`               | `email`            | User's email address                                                                               |
| `phone`               | `sms`, `whatsapp`  | User's phone number in E.164 format (e.g. `+919876543210`)                                         |

**Response `202`:**

```json
{
  "success": true,
  "notification_id": "550e8400-e29b-41d4-a716-446655440000",
  "channels_enqueued": ["push", "email", "inapp"]
}
```

Use `notification_id` to later fetch delivery logs via `GET /notifications/:notificationId/logs`.

---

### 7.5 Fetch User Notifications (Bell Icon)

```
GET /notifications/:userId
GET /notifications/:userId?page=1&limit=20
```

**Auth:** `x-api-key`  
**Use:** Power the in-app notification inbox / bell icon in your UI.

| Query param | Default | Max   | Description           |
| ----------- | ------- | ----- | --------------------- |
| `page`      | `1`     | —     | Page number (1-based) |
| `limit`     | `20`    | `100` | Items per page        |

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "fee_due",
      "title": "Fee Reminder 💰",
      "message": "Hi Rahul Sharma, your fee of ₹5000 is due on March 5, 2026.",
      "data": { "fee_id": "fee_789" },
      "action_url": "https://tutrsy.com/fees",
      "status": "delivered",
      "is_read": false,
      "read_at": null,
      "created_at": "2026-02-28T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  },
  "unread_count": 7
}
```

> **Note:** Only `inapp` channel notifications appear here. Push, email, SMS, and WhatsApp are delivery-only and do not appear in this inbox.

---

### 7.6 Mark a Notification as Read

```
PATCH /notifications/:notificationId/read
```

**Auth:** `x-api-key`  
**Use:** Call this when a user taps or opens a specific notification.

**Response `200`:**

```json
{ "success": true }
```

**Response `404`** if the notification does not belong to the app or was already read.

---

### 7.7 Mark All Notifications as Read

```
POST /notifications/:userId/read-all
```

**Auth:** `x-api-key`  
**Use:** "Mark all as read" button in your notification centre.

**Response `200`:**

```json
{ "success": true }
```

---

### 7.8 Delivery Logs

```
GET /notifications/:notificationId/logs
```

**Auth:** `x-api-key`  
**Use:** Debug delivery issues. Shows the result of every channel attempt.

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "channel": "push",
      "status": "sent",
      "provider": "onesignal",
      "provider_message_id": "onesignal-uuid-here",
      "attempt_number": 1,
      "error": null,
      "sent_at": "2026-02-28T10:00:05Z"
    },
    {
      "channel": "email",
      "status": "failed",
      "provider": "onesignal",
      "provider_message_id": null,
      "attempt_number": 1,
      "error": "User has no email address",
      "sent_at": "2026-02-28T10:00:05Z"
    },
    {
      "channel": "email",
      "status": "sent",
      "provider": "onesignal",
      "provider_message_id": "onesignal-uuid-here",
      "attempt_number": 2,
      "error": null,
      "sent_at": "2026-02-28T10:00:15Z"
    }
  ]
}
```

### 7.7 WhatsApp Session Management

These endpoints manage WAHA WhatsApp sessions. Each entity (e.g. coaching centre) links one WhatsApp number via a QR-code scanning flow.

#### Create / Re-create Session

```
POST /whatsapp/sessions
Headers: x-api-key: <your-api-key>
Body: {
  "entity_id": "coaching_center_1"
}
```

**Response `201`:**

```json
{
  "success": true,
  "session": "myapp-coaching-center-1",
  "status": "pending",
  "qr_code": "data:image/png;base64,..."
}
```

The QR code must be displayed to the user for scanning with their WhatsApp mobile app. Poll the GET endpoint to check when the session becomes `active`.

#### Get Session Status

```
GET /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

**Response `200`:**

```json
{
  "success": true,
  "session": {
    "entity_id": "coaching_center_1",
    "waha_session": "myapp-coaching-center-1",
    "phone_number": "+919876543210",
    "status": "active",
    "qr_code": null,
    "connected_at": "2026-03-01T10:00:00.000Z"
  }
}
```

#### Delete / Logout Session

```
DELETE /whatsapp/sessions/:entity_id
Headers: x-api-key: <your-api-key>
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Session disconnected"
}
```

#### Webhook (WAHA → BlueMQ)

```
POST /whatsapp/sessions/webhook?secret=<WAHA_WEBHOOK_SECRET>
```

This endpoint is called by the WAHA container when session status changes (e.g. QR scanned, disconnected). **No `x-api-key` header required** — authentication is via the `secret` query parameter.

WAHA status mappings:

| WAHA Status                 | BlueMQ Status  |
| --------------------------- | -------------- |
| `WORKING`                   | `active`       |
| `FAILED` / `STOPPED`        | `disconnected` |
| `STARTING` / `SCAN_QR_CODE` | `pending`      |

---

## 8. Template System

### How Templates Work

1. You register a template by `type` and `channel` (e.g. `type=fee_due`, `channel=push`).
2. When you call `POST /notify` with `type: "fee_due"` and `channels: ["push"]`, BlueMQ fetches the template from the database, renders the `{{variable}}` placeholders from your `variables` object, and uses the result as the notification content.
3. If no template is found for a channel, a **generic fallback** is used: `title` defaults to the type (with underscores replaced by spaces) and `body` defaults to `variables.body || variables.message || "Notification: {type}"`.

### Variable Syntax

Use double curly braces: `{{variable_name}}`.

Template body:

```
Hi {{student_name}}, your fee of ₹{{amount}} is due on {{due_date}}.
```

`variables` payload:

```json
{
  "student_name": "Rahul Sharma",
  "amount": "5000",
  "due_date": "March 5, 2026"
}
```

Rendered output:

```
Hi Rahul Sharma, your fee of ₹5000 is due on March 5, 2026.
```

If a variable key is missing from the `variables` object, the placeholder is left as-is (e.g. `{{student_name}}`).

### Template Strategy

A common pattern is to create one template per `(type, channel)` combination and re-use the `type` key across all channels:

| Type      | Channel    | Title                             | Body                                                                   |
| --------- | ---------- | --------------------------------- | ---------------------------------------------------------------------- |
| `fee_due` | `push`     | `Fee Reminder 💰`                 | `Hi {{student_name}}, fee of ₹{{amount}} due`                          |
| `fee_due` | `email`    | `Fee Reminder — {{student_name}}` | `<html>...longer HTML email body...</html>`                            |
| `fee_due` | `sms`      | _(null)_                          | `BlueMQ: Fee of ₹{{amount}} due. Pay: {{action_url}}`                  |
| `fee_due` | `whatsapp` | `Fee Reminder`                    | `Hi {{student_name}}! Your fee of ₹{{amount}} is due on {{due_date}}.` |
| `fee_due` | `in_app`   | `Fee Reminder 💰`                 | `Your fee of ₹{{amount}} is due on {{due_date}}`                       |

---

## 9. Notification Channels Explained

### Push (`push`)

- **Provider:** OneSignal
- **Delivery address:** `user.onesignal_player_id` (preferred) or `user.external_user_id`
- **Concurrency:** 10 workers
- **Retries:** 3 (exponential back-off starting at 5 seconds)
- **Notes:** The `action_url` is set as the notification's click URL. The `data` object is attached as the notification's extra data payload (accessible in your mobile app).

### Email (`email`)

- **Provider:** OneSignal
- **Delivery address:** `user.email`
- **Concurrency:** 5 workers
- **Retries:** 3 (exponential back-off starting at 10 seconds)
- **Notes:** The `title` becomes the email subject. The `body` is wrapped in a minimal `<html><body>` envelope. For rich HTML emails, put your full HTML directly in the template body.

### SMS (`sms`)

- **Provider:** OneSignal
- **Delivery address:** `user.phone` (E.164 format, e.g. `+919876543210`)
- **Concurrency:** 5 workers
- **Retries:** 5 (exponential back-off starting at 30 seconds)
- **Notes:** Only the `body` field is sent (SMS has no subject). Keep body under 160 characters to avoid multi-part SMS charges.

### WhatsApp (`whatsapp`)

- **Provider:** WAHA (self-hosted WhatsApp Web automation)
- **Delivery address:** `user.phone` (E.164 format, converted to `phone@c.us` chatId)
- **Concurrency:** 5 workers
- **Retries:** 5 (exponential back-off starting at 30 seconds)
- **Requires:** An active WAHA session for the `entity_id`. Sessions are managed via the `/whatsapp/sessions` endpoints.
- **Notes:** The WhatsApp worker first looks up the active session for the given `entity_id` (e.g. coaching centre). If no active session is found, the job fails immediately without retries. Messages are sent as plain text via the WAHA REST API.

### In-App (`inapp`)

- **Provider:** Direct database write (no external API)
- **Delivery address:** `user_id` (maps directly to `external_user_id` in the DB)
- **Concurrency:** 20 workers
- **Retries:** 2 (fixed 2-second delay)
- **Notes:** The notification is already in the database from the `/notify` route itself. The `inapp` worker simply logs the delivery. Your frontend fetches these via `GET /notifications/:userId`.

---

## 10. Multi-Tenant Model

BlueMQ is built for a single operator running the service for multiple client applications.

```
BlueMQ Instance
    ├── App: tutrsy  (api_key: bmq_aaa...)
    │       ├── Templates for "fee_due", "class_reminder", ...
    │       └── Notifications for their users
    │
    └── App: schoolapp  (api_key: bmq_bbb...)
            ├── Templates for "exam_result", "attendance_alert", ...
            └── Notifications for their users
```

- **Operator** controls `SERVICE_API_KEY_SECRET` and calls `POST /apps/register` to provision each client.
- **Client** stores their `bmq_` API key securely (in env vars, secrets manager, etc.) and calls `/notify`, `/templates`, and `/notifications` using `x-api-key`.
- **Data isolation** is enforced at the database query level — every query includes `WHERE app_id = ?`.

---

## 11. Queue & Retry Behaviour

### Queue Configuration

| Channel    | Queue Name        | Concurrency | Max Attempts      | Back-off              |
| ---------- | ----------------- | ----------- | ----------------- | --------------------- |
| `push`     | `bluemq:push`     | 10          | 4 (3 retries + 1) | Exponential, 5s base  |
| `email`    | `bluemq:email`    | 5           | 4 (3 retries + 1) | Exponential, 10s base |
| `sms`      | `bluemq:sms`      | 5           | 6 (5 retries + 1) | Exponential, 30s base |
| `whatsapp` | `bluemq:whatsapp` | 5           | 6 (5 retries + 1) | Exponential, 30s base |
| `inapp`    | `bluemq:inapp`    | 20          | 3 (2 retries + 1) | Fixed, 2s             |

### Job Retention

- **Completed jobs:** Last 1,000 kept in Redis (for BullMQ dashboard inspection).
- **Failed jobs:** Last 5,000 kept in Redis.

### Deduplication

Each job has a unique `jobId` of `{notificationId}:{channel}`. If `POST /notify` is called twice with the same `notificationId` (which is UUID-generated per request, so this is only relevant if you're implementing retry at the API layer), BullMQ will skip duplicate jobs.

### What Triggers a Retry

The worker throws an error when the provider returns `success: false`. BullMQ catches this and schedules a retry with the configured back-off delay. After all retries are exhausted, the job moves to the `failed` state and the notification status is updated to `failed` in the database.

---

## 12. Provider System & Extensibility

### Current Provider Map

| Channel    | Primary Provider  | Fallback           |
| ---------- | ----------------- | ------------------ |
| `push`     | OneSignal         | _(not configured)_ |
| `email`    | OneSignal         | _(not configured)_ |
| `sms`      | OneSignal         | _(not configured)_ |
| `whatsapp` | WAHA (self-host)  | _(not configured)_ |
| `inapp`    | InApp (DB direct) | —                  |

### How the Registry Works

The provider registry (`src/providers/registry.js`) maps each channel to a provider instance. Workers do not know which provider they are using — they call `registry.send(channel, payload)`, which resolves the correct provider and method automatically.

To swap a provider, you only change `src/providers/bootstrap.js`. Zero changes to workers, queues, or routes.

---

## 13. Database Schema

### `apps` table

| Column       | Type         | Description                                |
| ------------ | ------------ | ------------------------------------------ |
| `id`         | UUID         | Internal primary key                       |
| `app_id`     | VARCHAR(64)  | Public identifier (e.g. `tutrsy`) — unique |
| `name`       | VARCHAR(255) | Human-readable app name                    |
| `api_key`    | VARCHAR(255) | The `bmq_` API key                         |
| `created_at` | TIMESTAMPTZ  | Registration time                          |

### `templates` table

| Column       | Type         | Description                            |
| ------------ | ------------ | -------------------------------------- |
| `id`         | UUID         | Primary key                            |
| `app_id`     | VARCHAR(64)  | FK → apps.app_id                       |
| `type`       | VARCHAR(128) | Template type (e.g. `fee_due`)         |
| `channel`    | VARCHAR(32)  | Channel name                           |
| `title`      | VARCHAR(512) | Notification title/subject             |
| `body`       | TEXT         | Notification body (supports `{{var}}`) |
| `cta_text`   | VARCHAR(255) | Call-to-action text                    |
| `is_active`  | BOOLEAN      | Whether this template is in use        |
| `created_at` | TIMESTAMPTZ  | —                                      |
| `updated_at` | TIMESTAMPTZ  | Auto-updated on each PUT               |

**Unique constraint:** `(app_id, type, channel)` — one template per app per type per channel.

### `notifications` table

| Column             | Type         | Description                                               |
| ------------------ | ------------ | --------------------------------------------------------- |
| `id`               | UUID         | Primary key — the `notification_id` returned by `/notify` |
| `app_id`           | VARCHAR(64)  | FK → apps.app_id                                          |
| `external_user_id` | VARCHAR(255) | Your app's user ID                                        |
| `type`             | VARCHAR(128) | Notification type                                         |
| `title`            | VARCHAR(512) | Rendered title (from primary channel's template)          |
| `message`          | TEXT         | Rendered body                                             |
| `data`             | JSONB        | The `data` object from the request                        |
| `action_url`       | TEXT         | Deep-link URL                                             |
| `status`           | VARCHAR(32)  | `pending` → `delivered` / `partial` / `failed`            |
| `is_read`          | BOOLEAN      | Whether the user has read this in-app notification        |
| `read_at`          | TIMESTAMPTZ  | When it was read                                          |
| `created_at`       | TIMESTAMPTZ  | When the notification was created                         |

**Indexes:** `(app_id, external_user_id, created_at DESC)` and `(status)`.

### `notification_logs` table

| Column                | Type         | Description                                   |
| --------------------- | ------------ | --------------------------------------------- |
| `id`                  | UUID         | Primary key                                   |
| `notification_id`     | UUID         | FK → notifications.id                         |
| `channel`             | VARCHAR(32)  | Which channel this log is for                 |
| `status`              | VARCHAR(32)  | `sent` / `failed` / `permanently_failed`      |
| `provider`            | VARCHAR(64)  | Provider name (e.g. `onesignal`, `waha`)      |
| `provider_message_id` | VARCHAR(255) | ID returned by the provider for tracking      |
| `attempt_number`      | INT          | Which attempt this log entry is for (1-based) |
| `error`               | TEXT         | Error message if failed                       |
| `sent_at`             | TIMESTAMPTZ  | Timestamp of this attempt                     |

### `whatsapp_sessions` table

| Column            | Type         | Description                                                 |
| ----------------- | ------------ | ----------------------------------------------------------- |
| `id`              | UUID         | Primary key                                                 |
| `app_id`          | VARCHAR(64)  | FK → apps.app_id                                            |
| `entity_id`       | VARCHAR(255) | Logical entity (e.g. coaching centre) that owns the session |
| `waha_session`    | VARCHAR(255) | UNIQUE session name used in WAHA                            |
| `phone_number`    | VARCHAR(20)  | WhatsApp phone number (populated once session is active)    |
| `status`          | VARCHAR(32)  | `pending` / `active` / `disconnected` / `banned`            |
| `qr_code`         | TEXT         | Base64 QR code for scanning (null once connected)           |
| `connected_at`    | TIMESTAMPTZ  | When the session became active                              |
| `disconnected_at` | TIMESTAMPTZ  | When the session was disconnected/logged out                |
| `created_at`      | TIMESTAMPTZ  | When the session was created                                |

**Constraints:** `UNIQUE(app_id, entity_id)`. Partial index on `(app_id, entity_id) WHERE status = 'active'`.

---

## 14. Notification Status Lifecycle

```
POST /notify called
       │
       ▼
  status = 'pending'
       │
       ├──── All channels succeed ──────────► status = 'delivered'
       │
       ├──── Some channels succeed,
       │     some previously failed ─────────► status = 'partial'
       │
       └──── All channels fail after
             all retries ───────────────────► status = 'failed'
```

**Status values:**

| Status      | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `pending`   | Notification saved, jobs enqueued. No worker has successfully processed any channel yet. |
| `delivered` | At least one channel was successfully delivered.                                         |
| `partial`   | One channel succeeded after another had previously failed (mixed result).                |
| `failed`    | All channels permanently failed after exhausting all retries.                            |

---

## 15. Step-by-Step Integration Guide

This section walks you through integrating BlueMQ into your Node.js application from scratch.

### Step 1 — Register your app (one-time setup)

As the **BlueMQ operator**, call this from your terminal or a setup script:

```bash
curl -X POST https://your-bluemq.railway.app/apps/register \
  -H "Content-Type: application/json" \
  -H "x-service-secret: your-SERVICE_API_KEY_SECRET" \
  -d '{ "app_id": "myapp", "name": "My Application" }'
```

Save the returned `api_key` in your application's secrets (environment variable, secrets manager, etc.).

### Step 2 — Create your notification templates

For each notification type your app sends, create one template per channel:

```bash
# Push template for "order_shipped"
curl -X POST https://your-bluemq.railway.app/templates \
  -H "Content-Type: application/json" \
  -H "x-api-key: bmq_your_api_key_here" \
  -d '{
    "type":    "order_shipped",
    "channel": "push",
    "title":   "Your order is on the way! 🚚",
    "body":    "Hi {{customer_name}}, order #{{order_id}} has been shipped.",
    "cta_text":"Track Order"
  }'

# Email template for "order_shipped"
curl -X POST https://your-bluemq.railway.app/templates \
  -H "Content-Type: application/json" \
  -H "x-api-key: bmq_your_api_key_here" \
  -d '{
    "type":    "order_shipped",
    "channel": "email",
    "title":   "Your order #{{order_id}} has shipped",
    "body":    "<h2>Hi {{customer_name}}</h2><p>Your order is on the way! Track it <a href=\"{{tracking_url}}\">here</a>.</p>"
  }'

# In-app template for "order_shipped"
curl -X POST https://your-bluemq.railway.app/templates \
  -H "Content-Type: application/json" \
  -H "x-api-key: bmq_your_api_key_here" \
  -d '{
    "type":    "order_shipped",
    "channel": "in_app",
    "title":   "Order Shipped 🚚",
    "body":    "Order #{{order_id}} has been shipped and is on its way."
  }'
```

### Step 3 — Send a notification from your backend

Whenever an order ships, call:

```javascript
// In your order service (Node.js example)
const axios = require("axios");

async function notifyOrderShipped(order, customer) {
  const response = await axios.post(
    "https://your-bluemq.railway.app/notify",
    {
      user_id: customer.id, // your DB user ID
      type: "order_shipped",
      channels: ["push", "email", "inapp"],
      variables: {
        customer_name: customer.name,
        order_id: order.id,
        tracking_url: order.trackingUrl,
      },
      user: {
        email: customer.email,
        onesignal_player_id: customer.onesignalPlayerId, // from your mobile SDK
      },
      action_url: `https://myapp.com/orders/${order.id}`,
      data: {
        order_id: order.id,
        status: "shipped",
      },
    },
    {
      headers: {
        "x-api-key": process.env.BLUEMQ_API_KEY,
      },
    },
  );

  console.log("Notification queued:", response.data.notification_id);
  return response.data.notification_id;
}
```

### Step 4 — Build the in-app notification bell (frontend)

```javascript
// React example — notification bell component

async function fetchNotifications(userId, page = 1) {
  const res = await fetch(
    `https://your-bluemq.railway.app/notifications/${userId}?page=${page}&limit=20`,
    {
      headers: { "x-api-key": BLUEMQ_API_KEY },
    },
  );
  return res.json();
  // { data: [...], pagination: {...}, unread_count: 7 }
}

async function markAsRead(notificationId) {
  await fetch(
    `https://your-bluemq.railway.app/notifications/${notificationId}/read`,
    {
      method: "PATCH",
      headers: { "x-api-key": BLUEMQ_API_KEY },
    },
  );
}

async function markAllRead(userId) {
  await fetch(
    `https://your-bluemq.railway.app/notifications/${userId}/read-all`,
    {
      method: "POST",
      headers: { "x-api-key": BLUEMQ_API_KEY },
    },
  );
}
```

> **Security note for frontend:** Never expose your `x-api-key` in a public client-side app. Route all BlueMQ calls through your own backend API which then forwards to BlueMQ with the key server-side.

---

## 16. Code Examples

### Python (requests)

```python
import requests
import os

BLUEMQ_URL = "https://your-bluemq.railway.app"
BLUEMQ_API_KEY = os.environ["BLUEMQ_API_KEY"]

def send_notification(user_id, notification_type, variables, channels, user_info, action_url=None, data=None):
    response = requests.post(
        f"{BLUEMQ_URL}/notify",
        json={
            "user_id":   user_id,
            "type":      notification_type,
            "channels":  channels,
            "variables": variables,
            "user":      user_info,
            "action_url": action_url,
            "data":      data or {},
        },
        headers={"x-api-key": BLUEMQ_API_KEY},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()  # { "notification_id": "...", "channels_enqueued": [...] }

# Usage
result = send_notification(
    user_id="user_456",
    notification_type="fee_due",
    variables={"student_name": "Priya", "amount": "3500", "due_date": "March 10"},
    channels=["push", "whatsapp", "inapp"],
    user_info={"phone": "+919123456789", "onesignal_player_id": "xyz-player-id"},
    action_url="https://myapp.com/fees",
)
print(result["notification_id"])
```

### PHP (cURL)

```php
<?php
function sendNotification(string $userId, string $type, array $variables, array $channels, array $user): array
{
    $payload = json_encode([
        'user_id'   => $userId,
        'type'      => $type,
        'channels'  => $channels,
        'variables' => $variables,
        'user'      => $user,
    ]);

    $ch = curl_init('https://your-bluemq.railway.app/notify');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $_ENV['BLUEMQ_API_KEY'],
        ],
    ]);

    $response = curl_exec($ch);
    curl_close($ch);

    return json_decode($response, true);
}

$result = sendNotification(
    'user_789',
    'class_reminder',
    ['class_name' => 'Mathematics', 'time' => '10:00 AM'],
    ['push', 'inapp'],
    ['onesignal_player_id' => 'player-abc']
);

echo $result['notification_id'];
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

type NotifyRequest struct {
    UserID    string                 `json:"user_id"`
    Type      string                 `json:"type"`
    Channels  []string               `json:"channels"`
    Variables map[string]string      `json:"variables"`
    User      map[string]string      `json:"user"`
    ActionURL string                 `json:"action_url,omitempty"`
}

func sendNotification(req NotifyRequest) (string, error) {
    body, _ := json.Marshal(req)

    httpReq, _ := http.NewRequest("POST", "https://your-bluemq.railway.app/notify", bytes.NewBuffer(body))
    httpReq.Header.Set("Content-Type", "application/json")
    httpReq.Header.Set("x-api-key", os.Getenv("BLUEMQ_API_KEY"))

    resp, err := http.DefaultClient.Do(httpReq)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)

    return result["notification_id"].(string), nil
}

func main() {
    id, err := sendNotification(NotifyRequest{
        UserID:   "user_101",
        Type:     "new_message",
        Channels: []string{"push", "inapp"},
        Variables: map[string]string{"sender": "Amit", "preview": "Hey, how are you?"},
        User:     map[string]string{"onesignal_player_id": "player-xyz"},
    })
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Notification ID:", id)
}
```

---

## 17. Error Handling Reference

### HTTP Status Codes

| Code                        | Meaning                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `202 Accepted`              | Notification queued successfully.                                                    |
| `400 Bad Request`           | Missing or invalid fields. Check the `error` field in the response body for details. |
| `401 Unauthorized`          | Missing or invalid `x-api-key`.                                                      |
| `403 Forbidden`             | Invalid `x-service-secret` on `POST /apps/register`.                                 |
| `404 Not Found`             | Resource not found (notification, template, etc.).                                   |
| `500 Internal Server Error` | Unexpected server error. Check BlueMQ logs.                                          |

### Common `400` Errors

| Error message                                                  | Fix                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Required fields: user_id, type, channels`                     | Ensure all three fields are present in the request body.                     |
| `Invalid channels: xyz`                                        | Use only `push`, `email`, `sms`, `whatsapp`, or `inapp`.                     |
| `user object is required with delivery addresses`              | Include the `user` object even if it is empty `{}`.                          |
| `Required: type, channel, body`                                | All three are required when creating a template.                             |
| `Invalid channel. Allowed: push, email, sms, whatsapp, in_app` | Note: templates use `in_app` (with underscore) while `/notify` uses `inapp`. |

---

## 18. Adding a Custom Provider

Say you want to add **Firebase Cloud Messaging (FCM)** as an alternative push provider.

### Step 1 — Create the provider file

Create `src/providers/fcm.provider.js`:

```javascript
const { INotificationProvider } = require("./interface");
const axios = require("axios");

class FCMProvider extends INotificationProvider {
  constructor() {
    super("fcm");
    this.serverKey = process.env.FCM_SERVER_KEY;
  }

  async sendPush(payload) {
    const { title, body, actionUrl, user, data } = payload;

    if (!user.fcm_token) {
      return { success: false, error: "User has no FCM token" };
    }

    try {
      const res = await axios.post(
        "https://fcm.googleapis.com/fcm/send",
        {
          to: user.fcm_token,
          notification: { title, body, click_action: actionUrl },
          data: data || {},
        },
        {
          headers: {
            Authorization: `key=${this.serverKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return { success: true, providerMessageId: res.data.message_id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // sendEmail, sendSMS, sendWhatsApp, sendInApp will throw NotSupportedError
  // automatically (inherited from INotificationProvider base class)
}

module.exports = { FCMProvider };
```

### Step 2 — Register in bootstrap

Edit `src/providers/bootstrap.js`:

```javascript
const { FCMProvider } = require("./fcm.provider");

function bootstrapProviders() {
  // ...existing code...

  // Option A: Replace OneSignal with FCM for push
  registry.register("push", new FCMProvider());

  // Option B: Keep OneSignal as primary, FCM as fallback
  registry.register("push", onesignal);
  registry.registerFallback("push", new FCMProvider());
}
```

**That's it.** No changes to workers, queues, routes, or any other file.

---

## 19. Next.js Integration Guide

This section is a complete, copy-paste-ready guide for integrating BlueMQ into a **Next.js 14 / 15 (App Router)** application. It covers the server side (sending notifications), the client side (bell icon inbox), and push notification device registration via the OneSignal Web SDK.

> All examples use **TypeScript**. If you are on plain JavaScript, simply remove the type annotations.

---

### 19.1 Architecture in a Next.js App

```
Next.js App
│
├── app/                         ← App Router pages & layouts
│
├── lib/
│   └── bluemq.ts                ← Server-side BlueMQ HTTP client (never sent to browser)
│
├── app/api/
│   ├── notifications/route.ts   ← Proxy: GET /notifications/:userId
│   └── notifications/
│       └── [id]/
│           └── read/route.ts    ← Proxy: PATCH /notifications/:id/read
│
├── actions/
│   └── notify.ts                ← Server Actions that call BlueMQ
│
└── components/
    ├── NotificationBell.tsx     ← Bell icon with unread badge
    ├── NotificationPanel.tsx    ← Dropdown list of notifications
    └── NotificationItem.tsx     ← Single row item
```

**Why proxy through Next.js API routes?**  
Your `BLUEMQ_API_KEY` must **never** be exposed to the browser. All BlueMQ calls that carry the API key happen server-side (Server Actions or API Routes). The client only talks to your own Next.js backend.

---

### 19.2 Environment Setup

Add these to your `.env.local` (never committed) and your deployment environment:

```env
# .env.local

# BlueMQ Service URL (where you deployed BlueMQ)
BLUEMQ_URL=https://your-bluemq.railway.app

# Your app's API key from POST /apps/register
# Prefix bmq_ — keep this SERVER-SIDE ONLY
BLUEMQ_API_KEY=bmq_your_64_char_hex_key_here

# OneSignal Web SDK (safe to expose to browser — it's a public App ID)
NEXT_PUBLIC_ONESIGNAL_APP_ID=your-onesignal-app-id
```

> **Rule:** Any variable starting with `NEXT_PUBLIC_` is embedded into the browser bundle. Never put `BLUEMQ_API_KEY` here — leave it without the `NEXT_PUBLIC_` prefix.

---

### 19.3 BlueMQ Server-Side Client

Create `lib/bluemq.ts`. This module is **only used in server-side code** (Server Actions, Route Handlers, `getServerSideProps`). It is never imported in a Client Component.

```typescript
// lib/bluemq.ts

const BLUEMQ_URL = process.env.BLUEMQ_URL!;
const BLUEMQ_API_KEY = process.env.BLUEMQ_API_KEY!;

if (!BLUEMQ_URL || !BLUEMQ_API_KEY) {
  throw new Error(
    "BLUEMQ_URL and BLUEMQ_API_KEY must be set in environment variables",
  );
}

// ─── Types ───────────────────────────────────────────────────────────

export type NotificationChannel =
  | "push"
  | "email"
  | "sms"
  | "whatsapp"
  | "inapp";

export interface SendNotificationOptions {
  userId: string;
  type: string;
  channels: NotificationChannel[];
  variables?: Record<string, string>;
  user: {
    email?: string;
    phone?: string;
    onesignalPlayerId?: string;
  };
  actionUrl?: string;
  data?: Record<string, unknown>;
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string | null;
  message: string | null;
  data: Record<string, unknown>;
  action_url: string | null;
  status: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  success: boolean;
  data: NotificationRecord[];
  pagination: { page: number; limit: number; total: number; pages: number };
  unread_count: number;
}

// ─── Helper ──────────────────────────────────────────────────────────

async function bluemqFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BLUEMQ_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": BLUEMQ_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `BlueMQ ${options.method ?? "GET"} ${path} failed (${res.status}): ${body}`,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Send a notification via BlueMQ.
 * Returns the notification_id for later log queries.
 */
export async function sendNotification(
  opts: SendNotificationOptions,
): Promise<{ notification_id: string; channels_enqueued: string[] }> {
  return bluemqFetch("/notify", {
    method: "POST",
    body: JSON.stringify({
      user_id: opts.userId,
      type: opts.type,
      channels: opts.channels,
      variables: opts.variables ?? {},
      user: {
        email: opts.user.email,
        phone: opts.user.phone,
        onesignal_player_id: opts.user.onesignalPlayerId,
      },
      action_url: opts.actionUrl,
      data: opts.data ?? {},
    }),
  });
}

/**
 * Fetch the notification inbox for a user (server-side).
 */
export async function getNotifications(
  userId: string,
  page = 1,
  limit = 20,
): Promise<NotificationsResponse> {
  return bluemqFetch(`/notifications/${userId}?page=${page}&limit=${limit}`);
}

/**
 * Mark a single notification as read (server-side).
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  await bluemqFetch(`/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
}

/**
 * Mark all notifications as read for a user (server-side).
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await bluemqFetch(`/notifications/${userId}/read-all`, { method: "POST" });
}

/**
 * Fetch delivery logs for a notification (server-side, useful in admin pages).
 */
export async function getDeliveryLogs(notificationId: string) {
  return bluemqFetch(`/notifications/${notificationId}/logs`);
}
```

---

### 19.4 Sending Notifications from Server Actions

Server Actions are the recommended way to trigger notifications from form submissions, button clicks, or any server-side event in the App Router.

```typescript
// actions/notify.ts
"use server";

import { sendNotification } from "@/lib/bluemq";

/**
 * Example: send a fee reminder when a teacher clicks "Send Reminder"
 */
export async function sendFeeReminder(data: {
  studentId: string;
  studentName: string;
  amount: string;
  dueDate: string;
  email?: string;
  phone?: string;
  onesignalPlayerId?: string;
}) {
  try {
    const result = await sendNotification({
      userId: data.studentId,
      type: "fee_due",
      channels: ["push", "email", "inapp"],
      variables: {
        student_name: data.studentName,
        amount: data.amount,
        due_date: data.dueDate,
      },
      user: {
        email: data.email,
        phone: data.phone,
        onesignalPlayerId: data.onesignalPlayerId,
      },
      actionUrl: `https://yourapp.com/fees/${data.studentId}`,
      data: { student_id: data.studentId },
    });

    return { success: true, notificationId: result.notification_id };
  } catch (err) {
    console.error("[sendFeeReminder]", err);
    return { success: false, error: "Failed to send notification" };
  }
}

/**
 * Example: send an order shipped notification from a webhook handler
 */
export async function sendOrderShipped(order: {
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  trackingUrl: string;
  onesignalPlayerId?: string;
}) {
  await sendNotification({
    userId: order.customerId,
    type: "order_shipped",
    channels: ["push", "email", "inapp"],
    variables: {
      customer_name: order.customerName,
      order_id: order.orderId,
      tracking_url: order.trackingUrl,
    },
    user: {
      email: order.customerEmail,
      onesignalPlayerId: order.onesignalPlayerId,
    },
    actionUrl: `https://yourapp.com/orders/${order.orderId}`,
    data: { order_id: order.orderId },
  });
}
```

**Using the Server Action in a component:**

```tsx
// app/fees/[id]/page.tsx  (Server or Client Component)
"use client";

import { sendFeeReminder } from "@/actions/notify";
import { useTransition } from "react";

export default function FeeReminderButton({ student }: { student: any }) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await sendFeeReminder({
        studentId: student.id,
        studentName: student.name,
        amount: student.feeDue,
        dueDate: student.dueDate,
        email: student.email,
        phone: student.phone,
        onesignalPlayerId: student.onesignalPlayerId,
      });

      if (result.success) {
        alert("Reminder sent!");
      } else {
        alert("Failed to send reminder");
      }
    });
  };

  return (
    <button onClick={handleClick} disabled={isPending}>
      {isPending ? "Sending..." : "Send Fee Reminder"}
    </button>
  );
}
```

---

### 19.5 Sending Notifications from API Routes

If you prefer Route Handlers (e.g. for webhooks from external services), use this pattern:

```typescript
// app/api/webhooks/payment/route.ts

import { NextRequest, NextResponse } from "next/server";
import { sendNotification } from "@/lib/bluemq";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Verify webhook signature here...

  if (body.event === "payment.success") {
    const { userId, amount, invoiceId, userEmail, oneSignalPlayerId } = body;

    await sendNotification({
      userId,
      type: "payment_received",
      channels: ["push", "email", "inapp"],
      variables: {
        amount,
        invoice_id: invoiceId,
      },
      user: {
        email: userEmail,
        onesignalPlayerId: oneSignalPlayerId,
      },
      actionUrl: `https://yourapp.com/invoices/${invoiceId}`,
      data: { invoice_id: invoiceId },
    });
  }

  return NextResponse.json({ received: true });
}
```

---

### 19.6 `useNotifications` Hook

This hook is used inside **Client Components**. It calls your own Next.js proxy API routes (not BlueMQ directly) so the API key is never in the browser.

**Step 1 — Create the proxy API routes:**

```typescript
// app/api/notifications/[userId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getNotifications } from "@/lib/bluemq";

export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const limit = Number(searchParams.get("limit") ?? 20);

  const data = await getNotifications(params.userId, page, limit);
  return NextResponse.json(data);
}
```

```typescript
// app/api/notifications/[userId]/read-all/route.ts

import { NextRequest, NextResponse } from "next/server";
import { markAllNotificationsRead } from "@/lib/bluemq";

export async function POST(
  _req: NextRequest,
  { params }: { params: { userId: string } },
) {
  await markAllNotificationsRead(params.userId);
  return NextResponse.json({ success: true });
}
```

```typescript
// app/api/notifications/read/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { markNotificationRead } from "@/lib/bluemq";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await markNotificationRead(params.id);
  return NextResponse.json({ success: true });
}
```

**Step 2 — Create the hook:**

```typescript
// hooks/useNotifications.ts
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { NotificationRecord } from "@/lib/bluemq";

interface UseNotificationsOptions {
  userId: string;
  /** How often to poll for new notifications in ms. Default: 30000 (30s) */
  pollInterval?: number;
  limit?: number;
}

export function useNotifications({
  userId,
  pollInterval = 30_000,
  limit = 20,
}: UseNotificationsOptions) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(
    async (pageNum = 1, append = false) => {
      if (!userId) return;
      try {
        const res = await fetch(
          `/api/notifications/${userId}?page=${pageNum}&limit=${limit}`,
        );
        const json = await res.json();

        if (json.success) {
          setNotifications((prev) =>
            append ? [...prev, ...json.data] : json.data,
          );
          setUnreadCount(json.unread_count);
          setTotalPages(json.pagination.pages);
        }
      } catch (err) {
        console.error("[useNotifications] fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, limit],
  );

  // Initial load
  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications]);

  // Polling
  useEffect(() => {
    if (!pollInterval) return;
    intervalRef.current = setInterval(
      () => fetchNotifications(1),
      pollInterval,
    );
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications, pollInterval]);

  // Load more (pagination)
  const loadMore = useCallback(() => {
    if (page < totalPages) {
      const next = page + 1;
      setPage(next);
      fetchNotifications(next, true);
    }
  }, [page, totalPages, fetchNotifications]);

  // Mark one as read (optimistic UI)
  const markAsRead = useCallback(
    async (notificationId: string) => {
      // Optimistically update UI first
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      // Then call the API
      try {
        await fetch(`/api/notifications/read/${notificationId}`, {
          method: "PATCH",
        });
      } catch (err) {
        console.error("[useNotifications] markAsRead error:", err);
        // Revert on failure
        fetchNotifications(1);
      }
    },
    [fetchNotifications],
  );

  // Mark all as read (optimistic UI)
  const markAllRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        is_read: true,
        read_at: new Date().toISOString(),
      })),
    );
    setUnreadCount(0);

    try {
      await fetch(`/api/notifications/${userId}/read-all`, { method: "POST" });
    } catch (err) {
      console.error("[useNotifications] markAllRead error:", err);
      fetchNotifications(1);
    }
  }, [userId, fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    hasMore: page < totalPages,
    markAsRead,
    markAllRead,
    loadMore,
    refresh: () => fetchNotifications(1),
  };
}
```

---

### 19.7 Bell Icon Component

```tsx
// components/NotificationBell.tsx
"use client";

import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationPanel } from "./NotificationPanel";

interface NotificationBellProps {
  userId: string;
  className?: string;
}

export function NotificationBell({ userId, className }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    markAsRead,
    markAllRead,
    loadMore,
  } = useNotifications({ userId, pollInterval: 30_000 });

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Notifications — ${unreadCount} unread`}
        className="relative p-2 rounded-full hover:bg-gray-100 transition"
      >
        {/* Bell SVG icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 
               .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 flex items-center justify-center
                           min-w-[18px] h-[18px] px-1
                           bg-red-500 text-white text-xs font-bold rounded-full"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 z-20">
            <NotificationPanel
              notifications={notifications}
              isLoading={isLoading}
              hasMore={hasMore}
              onMarkRead={markAsRead}
              onMarkAllRead={markAllRead}
              onLoadMore={loadMore}
              onClose={() => setIsOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

---

### 19.8 Notification Dropdown Panel

```tsx
// components/NotificationPanel.tsx
"use client";

import type { NotificationRecord } from "@/lib/bluemq";
import { NotificationItem } from "./NotificationItem";

interface NotificationPanelProps {
  notifications: NotificationRecord[];
  isLoading: boolean;
  hasMore: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  onClose: () => void;
}

export function NotificationPanel({
  notifications,
  isLoading,
  hasMore,
  onMarkRead,
  onMarkAllRead,
  onClose,
  onLoadMore,
}: NotificationPanelProps) {
  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div
      className="w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-100
                    flex flex-col max-h-[480px] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">
          Notifications{" "}
          {unread > 0 && (
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({unread} unread)
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="text-xs text-blue-600 hover:underline"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
            Loading...
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-2">
            <span className="text-3xl">🔔</span>
            <span>No notifications yet</span>
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkRead={onMarkRead}
            />
          ))
        )}

        {/* Load more */}
        {!isLoading && hasMore && (
          <button
            onClick={onLoadMore}
            className="w-full py-3 text-sm text-blue-600 hover:bg-blue-50 transition"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
```

```tsx
// components/NotificationItem.tsx
"use client";

import type { NotificationRecord } from "@/lib/bluemq";

interface NotificationItemProps {
  notification: NotificationRecord;
  onMarkRead: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationItem({
  notification: n,
  onMarkRead,
}: NotificationItemProps) {
  const handleClick = () => {
    if (!n.is_read) onMarkRead(n.id);
    if (n.action_url) window.open(n.action_url, "_self");
  };

  return (
    <div
      onClick={handleClick}
      className={`
        flex gap-3 px-4 py-3 cursor-pointer transition
        hover:bg-gray-50
        ${!n.is_read ? "bg-blue-50/40" : ""}
      `}
    >
      {/* Unread dot */}
      <div className="mt-1.5 flex-shrink-0">
        {!n.is_read ? (
          <span className="block w-2 h-2 rounded-full bg-blue-500" />
        ) : (
          <span className="block w-2 h-2 rounded-full bg-transparent" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {n.title && (
          <p
            className={`text-sm font-medium text-gray-900 truncate ${!n.is_read ? "font-semibold" : ""}`}
          >
            {n.title}
          </p>
        )}
        {n.message && (
          <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
            {n.message}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
      </div>
    </div>
  );
}
```

**Using the bell in your layout:**

```tsx
// app/layout.tsx  (or app/dashboard/layout.tsx)

import { NotificationBell } from "@/components/NotificationBell";
import { auth } from "@/lib/auth"; // your auth solution (NextAuth, Clerk, etc.)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between px-6 py-3 border-b">
          <span className="font-bold text-lg">My App</span>
          <div className="flex items-center gap-4">
            {session?.user?.id && <NotificationBell userId={session.user.id} />}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

---

### 19.9 Registering OneSignal Push (Mobile/Web)

For the `push` channel to work, the user's browser or mobile device must be registered with OneSignal and the resulting **Player ID** must be stored in your database against the user.

#### Web Push (Next.js)

**Step 1 — Install the OneSignal Web SDK:**

```bash
npm install react-onesignal
```

**Step 2 — Create an initialisation component:**

```tsx
// components/OneSignalInit.tsx
"use client";

import { useEffect } from "react";
import OneSignal from "react-onesignal";

interface OneSignalInitProps {
  userId: string;
  /** Call this to save the player ID to your own DB */
  onPlayerIdReady: (playerId: string) => void;
}

export function OneSignalInit({ userId, onPlayerIdReady }: OneSignalInitProps) {
  useEffect(() => {
    OneSignal.init({
      appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!,
      allowLocalhostAsSecureOrigin: process.env.NODE_ENV === "development",
    }).then(async () => {
      // Link this device to your user
      await OneSignal.login(userId);

      const playerId = await OneSignal.User.PushSubscription.id;
      if (playerId) {
        onPlayerIdReady(playerId);
      }
    });
  }, [userId, onPlayerIdReady]);

  return null; // renders nothing, just runs the effect
}
```

**Step 3 — Save the Player ID to your database via a Server Action:**

```typescript
// actions/savePlayerId.ts
"use server";

import { db } from "@/lib/db"; // your Next.js database client

export async function saveOneSignalPlayerId(userId: string, playerId: string) {
  await db.user.update({
    where: { id: userId },
    data: { onesignalPlayerId: playerId },
  });
}
```

**Step 4 — Wire it together in your root layout or after-login page:**

```tsx
"use client";

import { OneSignalInit } from "@/components/OneSignalInit";
import { saveOneSignalPlayerId } from "@/actions/savePlayerId";
import { useSession } from "next-auth/react"; // or your auth provider

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return (
    <>
      {userId && (
        <OneSignalInit
          userId={userId}
          onPlayerIdReady={(playerId) =>
            saveOneSignalPlayerId(userId, playerId)
          }
        />
      )}
      {children}
    </>
  );
}
```

**Step 5 — Use the stored Player ID when sending notifications:**

```typescript
// In your server action / route handler — fetch the user's player ID from DB first
const user = await db.user.findUnique({ where: { id: userId } });

await sendNotification({
  userId,
  type: "new_message",
  channels: ["push", "inapp"],
  variables: { sender: "Amit", preview: "Hey, are you free?" },
  user: {
    email: user.email,
    onesignalPlayerId: user.onesignalPlayerId ?? undefined, // from your DB
  },
});
```

---

### 19.10 Template Management from Next.js Admin

If you want to manage notification templates from a Next.js admin panel, use these server actions:

```typescript
// actions/templates.ts
"use server";

const BLUEMQ_URL = process.env.BLUEMQ_URL!;
const BLUEMQ_API_KEY = process.env.BLUEMQ_API_KEY!;

const headers = {
  "Content-Type": "application/json",
  "x-api-key": BLUEMQ_API_KEY,
};

export async function createTemplate(data: {
  type: string;
  channel: string;
  title?: string;
  body: string;
  cta_text?: string;
}) {
  const res = await fetch(`${BLUEMQ_URL}/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function listTemplates(type?: string, channel?: string) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (channel) params.set("channel", channel);
  const res = await fetch(`${BLUEMQ_URL}/templates?${params}`, { headers });
  return res.json();
}

export async function updateTemplate(
  id: string,
  data: {
    title?: string;
    body?: string;
    cta_text?: string;
    is_active?: boolean;
  },
) {
  const res = await fetch(`${BLUEMQ_URL}/templates/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteTemplate(id: string) {
  await fetch(`${BLUEMQ_URL}/templates/${id}`, { method: "DELETE", headers });
}
```

---

### Complete Next.js File Structure

After following this guide, your Next.js project will have these BlueMQ-related files:

```
your-nextjs-app/
│
├── .env.local
│     BLUEMQ_URL=...
│     BLUEMQ_API_KEY=...
│     NEXT_PUBLIC_ONESIGNAL_APP_ID=...
│
├── lib/
│   └── bluemq.ts                         ← Server-side client (never in browser)
│
├── hooks/
│   └── useNotifications.ts               ← Client hook for bell icon
│
├── actions/
│   ├── notify.ts                         ← Server Actions to send notifications
│   ├── savePlayerId.ts                   ← Save OneSignal player ID
│   └── templates.ts                      ← Template CRUD (admin)
│
├── app/api/
│   ├── notifications/
│   │   └── [userId]/
│   │       ├── route.ts                  ← GET proxy
│   │       └── read-all/route.ts         ← POST proxy
│   └── notifications/read/
│       └── [id]/route.ts                 ← PATCH proxy
│
└── components/
    ├── NotificationBell.tsx              ← Bell with badge
    ├── NotificationPanel.tsx             ← Dropdown list
    ├── NotificationItem.tsx              ← Single row
    └── OneSignalInit.tsx                 ← Web push registration
```

---

## Quick Reference Card

```
BASE URL: https://your-bluemq.railway.app

─── No Auth ──────────────────────────────────────────────────────────
GET  /health                               Service status + queue stats

─── Admin Auth (x-service-secret) ───────────────────────────────────
POST /apps/register                        Register a new client app

─── App Auth (x-api-key) ─────────────────────────────────────────────
POST   /notify                             Send notification (async)

GET    /templates                          List templates
GET    /templates?type=fee_due             Filter by type
GET    /templates?type=fee_due&channel=push Filter by type + channel
POST   /templates                          Create/update template
PUT    /templates/:id                      Update template fields
DELETE /templates/:id                      Delete template

GET    /notifications/:userId              Fetch inbox (bell icon)
GET    /notifications/:userId?page=2&limit=10  Paginated
PATCH  /notifications/:notifId/read        Mark one as read
POST   /notifications/:userId/read-all     Mark all as read
GET    /notifications/:notifId/logs        Delivery logs for a notification
```

---

_Documentation generated from a full code review of the BlueMQ source._  
_For issues or contributions, see the project repository._
