# BlueMQ Technical Implementation Guide

This document is for developers integrating BlueMQ into their own product backend.

It is intentionally implementation-heavy and maps to current runtime behavior in this repository.

## 1. Scope and Integration Model

BlueMQ should be integrated from your server-side code, not directly from frontend/mobile clients.

Recommended boundary:

- Your app backend owns business events, user identity mapping, device token collection, and tenant-level policy.
- BlueMQ owns channel orchestration, provider delivery, queue retries, and delivery logs.

## 2. Prerequisites

Required to run BlueMQ:

- Node.js 18+
- PostgreSQL (Neon is supported)
- Redis (single, sentinel, or cluster)

Provider credentials as needed:

- Push: OneSignal or Firebase
- Email: Resend or OneSignal
- SMS: OneSignal
- WhatsApp: Meta Cloud API

## 3. Runtime and Boot Behavior

Supported modes:

- all: API + workers
- api: API only
- worker: workers only

Controls:

- PROCESS_MODE=all|api|worker
- WORKER_CHANNELS=push,email,sms,whatsapp,inapp
- CLI overrides: --mode and --channels

Important:

- Migrations run on startup in all/api mode.
- Migrations do not run in worker-only mode.

## 4. Environment Configuration

Core:

- PORT (default 3001)
- DATABASE_URL
- BASE_URL
- SERVICE_API_KEY_SECRET

Database resilience:

- DB_CONNECTION_TIMEOUT_MS
- DB_MAX_RETRIES
- DB_RETRY_DELAY_MS

Redis runtime:

- REDIS_MODE=single|sentinel|cluster
- REDIS_URL (single mode)
- REDIS_SENTINELS, REDIS_SENTINEL_NAME (sentinel mode)
- REDIS_CLUSTER_NODES (cluster mode)
- REDIS_DB
- REDIS_TLS_ENABLED
- REDIS_TLS_REJECT_UNAUTHORIZED

Provider routing flags:

- PROVIDER_PUSH_ONESIGNAL / PROVIDER_PUSH_FIREBASE
- PROVIDER_EMAIL_ONESIGNAL / PROVIDER_EMAIL_RESEND
- PROVIDER_SMS_ONESIGNAL
- PROVIDER_WHATSAPP_META

Provider credentials:

- ONESIGNAL_APP_ID
- ONESIGNAL_API_KEY
- RESEND_API_KEY
- RESEND_FROM_EMAIL
- FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY

Routing rule:

- Exactly one provider must be enabled for each configurable channel.
- Startup fails if a channel has zero or multiple active providers.

## 5. Tenant Onboarding and Authentication

### 5.1 OTP onboarding (recommended)

1. POST /auth/register/send-otp with email, app_name, app_id
2. POST /auth/register/verify-otp with email, code
3. Persist returned api_key securely

Response from verify endpoint includes:

- success
- app_id
- app_name
- api_key

### 5.2 OTP login

1. POST /auth/login/send-otp with email
2. POST /auth/login/verify-otp with email, code

Response includes existing app credentials:

- success
- app_id
- app_name
- api_key

### 5.3 Service-level app registration

- POST /apps/register with header x-service-secret
- Use only for internal/admin automation

Security note:

- Ensure SERVICE_API_KEY_SECRET is explicitly set in production.
- Do not rely on default fallback values.

### 5.4 App-authenticated routes

These require x-api-key:

- /notify
- /templates
- /notifications
- /whatsapp
- /schedules
- /apps/me

## 6. API Contract: Notify

Endpoint:

- POST /notify

Required fields:

- user_id (string)
- type (string)
- channels (non-empty array)
- user (object)

Optional fields:

- variables (object)
- action_url (string)
- data (object)
- entity_id (string)
- parent_entity_id (string)

Current accepted channel values in notify:

- push
- email
- sms
- whatsapp
- in_app

Legacy alias accepted:

- inapp (normalized to in_app)

Example:

```json
{
  "user_id": "student_123",
  "type": "fee_due",
  "channels": ["push", "email", "whatsapp", "in_app"],
  "entity_id": "center_a",
  "parent_entity_id": "org_root",
  "variables": {
    "student_name": "Rahul",
    "amount": "5000"
  },
  "user": {
    "email": "rahul@example.com",
    "phone": "919876543210",
    "onesignal_player_id": "abc-123",
    "fcm_token": "fcm-token"
  },
  "action_url": "https://yourapp.example.com/fees/fee_456",
  "data": {
    "fee_id": "fee_456"
  }
}
```

Success response:

- HTTP 202
- success
- notification_id
- channels_enqueued

### 6.1 Channel-specific recipient requirements

- push (OneSignal): user.onesignal_player_id preferred. If missing, provider attempts include_external_user_ids.
- push (Firebase): one of user.fcm_token, user.firebase_token, user.push_token is required.
- email: user.email
- sms: user.phone
- whatsapp: user.phone plus entity_id or parent_entity_id context, unless the
  app has an explicit active fallback WhatsApp session
- in_app: no external provider identity needed beyond user_id

### 6.2 WhatsApp edge handling

If whatsapp is requested without entity_id and parent_entity_id:

- WhatsApp is removed from effective delivery if other channels remain.
- Request fails with 400 only if WhatsApp was the only channel.

### 6.3 Template resolution in notify

Notify loads templates using:

- app_id + type + channel + is_active=true
- If multiple variants exist, it evaluates `condition_key` + `condition_value` against notify `variables` and picks the best match, else falls back to default variant.

BlueMQ does not impose any preset condition vocabulary. Your product defines the rule key and value names for each variant.

When template is missing, notify generates fallback payload:

- title: variables.title or type (underscores replaced)
- body: variables.body or variables.message or Notification for the type value
- ctaText: variables.cta_text or null
- actionUrl: template `cta_url` or variables.cta_url or request action_url

## 7. API Contract: Templates

Endpoints:

- GET /templates
- GET /templates/:id
- POST /templates
- PUT /templates/:id
- DELETE /templates/:id

Template variant fields:

- condition_key (optional)
- condition_value (optional)
- cta_url (optional)

These fields are fully user-defined; there are no BlueMQ-specific profile presets.

Current accepted channel values in templates route:

- push
- email
- sms
- whatsapp
- in_app

Compatibility notes:

- Legacy `inapp` is accepted and normalized to `in_app`.
- Worker queues still use internal `inapp` channel keys.

## 8. API Contract: Notifications (Inbox/Bell)

Endpoints:

- GET /notifications/:userId?page=1&limit=20
- PATCH /notifications/:notificationId/read
- POST /notifications/:userId/read-all
- GET /notifications/:notificationId/logs

List response includes:

- data[]
- pagination
- unread_count

Logs response includes per-attempt records:

- channel
- status
- provider
- provider_message_id
- attempt_number
- error
- sent_at

## 9. API Contract: WhatsApp Sessions (Meta)

Endpoints:

- POST /whatsapp/sessions
- PATCH /whatsapp/sessions/:entity_id/fallback
- GET /whatsapp/sessions
- GET /whatsapp/sessions/:entity_id
- POST /whatsapp/sessions/:entity_id/test-message
- DELETE /whatsapp/sessions/:entity_id

Create/update payload fields:

- entity_id (required)
- parent_entity_id (optional)
- is_fallback (optional boolean; one explicit fallback per app)
- connection_type (must be meta if provided)
- meta_api_key (required)
- meta_phone_number_id (required)
- meta_business_account_id (optional)

Behavior:

- Session lookup resolves direct entity, supplied parent, stored parent links,
  then an explicit active app fallback session.
- Parent links can therefore support more than one parent level, with cycle
  protection in the resolver.
- Fallback sessions are scoped by `app_id`; the database allows only one
  fallback session per app.
- GET single returns `resolved_entity_id`, `is_inherited`, `fallback_used`,
  and `resolution_source` (`direct`, `parent`, or `app_fallback`).
- DELETE marks disconnected and clears stored meta_api_key.
- test-message validates phone as digits-only, 7-15 length.

### 9.1 Configure an app fallback session

Do not hardcode a fallback entity or app ID in source code. Mark an existing
active Meta session through the authenticated session API:

```http
PATCH /whatsapp/sessions/tutrsy/fallback
x-api-key: <app-api-key>
Content-Type: application/json
```

```json
{ "is_fallback": true }
```

The API key determines the app scope and the request changes only the fallback
flag; it does not replace the stored Meta credentials. To configure and save a
new session at the same time, use `POST /whatsapp/sessions` instead:

```http
POST /whatsapp/sessions
x-api-key: <app-api-key>
Content-Type: application/json
```

```json
{
  "entity_id": "tutrsy",
  "is_fallback": true,
  "connection_type": "meta",
  "meta_api_key": "<meta-access-token>",
  "meta_phone_number_id": "<meta-phone-number-id>",
  "meta_business_account_id": "<meta-business-account-id>"
}
```

The API key determines the app scope. Setting `is_fallback: true` clears the
previous fallback for that app in the same transaction. The same request can
therefore be used across tenants and environments without code changes.

Migration `src/db/migrations/021_whatsapp_app_fallback.sql` adds the field and
its one-fallback-per-app constraint. Run the normal database migration before
using this field. When no active
direct, parent, or parent-of-parent session exists, delivery uses this fallback
session's provider credentials while retaining the original notification
entity IDs for auditing.

## 10. Queue and Worker Semantics

Per-channel queues:

- notifications-push
- notifications-email
- notifications-sms
- notifications-whatsapp
- notifications-inapp

Default attempts (retries + initial attempt):

- push: 4 attempts total
- email: 4 attempts total
- sms: 6 attempts total
- whatsapp: 6 attempts total
- inapp: 3 attempts total

Worker outcomes:

- Success logs status=sent and updates notifications status progression.
- Recoverable provider failures throw and are retried by BullMQ.
- Final failure logs permanently_failed and marks notification failed when not already delivered.
- WhatsApp missing-session path is treated as non-transient and does not throw for retry in that branch.

## 11. Notification Status Model

Master notification status values observed in current flow:

- pending
- delivered
- partial
- failed

Read-state fields:

- is_read
- read_at

## 12. Health and Observability

GET /health returns:

- status
- timestamp
- providers (active provider registry snapshot)
- queues (job counts for waiting, active, completed, failed, delayed)

Use /health for:

- readiness checks
- queue backlog alerting
- provider routing verification

## 13. Secure Integration Pattern (Recommended)

1. Keep BLUEMQ_BASE_URL and BLUEMQ_API_KEY only in server environment variables.
2. Build one server-side BlueMQ client wrapper.
3. Normalize your internal user/contact model to BlueMQ payload shape in one place.
4. Never let frontend clients call BlueMQ directly with x-api-key.

## 14. TypeScript Integration Example

```ts
export type BlueMqChannel = "push" | "email" | "sms" | "whatsapp" | "in_app";

export type BlueMqNotifyRequest = {
  user_id: string;
  type: string;
  channels: BlueMqChannel[];
  variables?: Record<string, string>;
  user: {
    email?: string;
    phone?: string;
    onesignal_player_id?: string;
    fcm_token?: string;
    firebase_token?: string;
    push_token?: string;
  };
  action_url?: string;
  data?: Record<string, unknown>;
  entity_id?: string;
  parent_entity_id?: string;
};

export class BlueMqClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...(init.headers || {}),
      },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        body.error || `BlueMQ request failed: ${response.status}`,
      );
    }

    return body as T;
  }

  async notify(payload: BlueMqNotifyRequest) {
    return this.request<{
      success: boolean;
      notification_id: string;
      channels_enqueued: string[];
    }>("/notify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getNotifications(userId: string, page = 1, limit = 20) {
    return this.request<{
      success: boolean;
      data: any[];
      unread_count: number;
    }>(`/notifications/${userId}?page=${page}&limit=${limit}`, {
      method: "GET",
    });
  }

  async getUnreadCount(userId: string) {
    return this.request<{ success: boolean; unread_count: number }>(
      `/notifications/${userId}/unread-count`,
      { method: "GET" },
    );
  }

  async deleteNotification(notificationId: string) {
    return this.request<{ success: boolean }>(
      `/notifications/${notificationId}`,
      { method: "DELETE" },
    );
  }

  /** Build a WebSocket URL for real-time notifications */
  getWsUrl(userId: string): string {
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    // If baseUrl includes /api, this produces /api/ws (supported by BlueMQ).
    return `${wsBase}/ws?api_key=${encodeURIComponent(this.apiKey)}&user_id=${encodeURIComponent(userId)}`;
  }
}
```

### 14.2 WebSocket Integration (Real-Time)

BlueMQ exposes a WebSocket server at `/ws` on the same port as the HTTP API.
For API-prefixed deployments, `/api/ws` is also supported.

#### Connection

```typescript
const client = new BlueMqClient(
  "https://your-bluemq.example.com",
  "bmq_your_key",
);
const wsUrl = client.getWsUrl("user_123");
const ws = new WebSocket(wsUrl);

ws.onmessage = (event) => {
  const { event: eventName, data } = JSON.parse(event.data);

  switch (eventName) {
    case "new_notification":
      // data = full notification object (id, type, title, message, etc.)
      // Update your bell icon badge count
      // Show a toast/snackbar for in-app notifications
      break;

    case "notification_deleted":
      // data = { id, was_read }
      // Remove from local notification list
      // Adjust unread count if !was_read
      break;
  }
};
```

#### Best Practices

- Reconnect with exponential backoff on disconnect
- Fetch `getUnreadCount()` after reconnect to sync state
- Keep the WebSocket URL server-side (build via API proxy, not in browser code)
- Only show toasts for in-app channel notifications (push/email/SMS are handled by their own channels)

## 15. Production Error-Handling Checklist

Implement at caller side:

- Retry on transient network failures to BlueMQ API.
- Do not retry on HTTP 400 payload errors until fixed.
- Handle HTTP 401/403 as credential/config issues.
- Capture returned notification_id for later traceability.
- For support tooling, fetch /notifications/:notificationId/logs to inspect channel-level errors.

## 16. End-to-End Rollout Plan

1. Enable one channel first (for example email).
2. Validate template rendering with staging data.
3. Add push with provider-specific token mapping.
4. Add WhatsApp only after entity session setup and test-message verification.
5. Add in-app reads to your bell/inbox UI.
6. Add alerting on /health queue backlogs and failed attempts.

## 17. Known Current Gaps and Safe Handling

1. Legacy deployments may still contain old `inapp` template rows if normalization SQL has not been run.
   Safe handling now: run startup schema migration/normalization in API mode before traffic.
2. OneSignal push target validation is not enforced at notify route level.
   Safe handling now: validate push recipient fields in your own backend before calling notify.
3. SERVICE_API_KEY_SECRET has a default fallback in config.
   Safe handling now: enforce explicit non-default secret in deployment config.

## 18. Go-Live Checklist

- [ ] Explicit production secrets set (no defaults)
- [ ] One provider enabled per channel flags verified
- [ ] Database migration completed
- [ ] Worker processes running for required channels
- [ ] OTP onboarding/login tested
- [ ] Notify happy path tested per channel
- [ ] Notification logs inspected for each channel
- [ ] WhatsApp test-message validated per entity
- [ ] /health monitored with alert thresholds
- [ ] API key never exposed to frontend/mobile client code

## 19. Related Docs

- DOCUMENTATION.md (business and operator overview)
- README.md (quick setup and local run)
- DEPLOYMENT.md and DEPLOY_DROPLET.md (deployment playbooks)

## 20. Scheduled Notifications Implementation

### 20.1 Overview

BlueMQ supports scheduled notifications where delivery is triggered at a future time. BlueMQ calls the client's `data_source_url` to get fresh notification data at execution time, keeping business logic in your app.

### 20.2 Creating a Scheduled Notification

```ts
// One-time schedule (fires once)
await blueMq.request("/schedules", {
  method: "POST",
  body: JSON.stringify({
    type: "one_time",
    template_key: "quiz_reminder",
    data_source_url: "https://your-app.com/api/bluemq/quiz-data",
    data_source_secret: "your-hmac-secret",
    audience: { quiz_id: "quiz_abc", enrolled: true },
    run_at: "2025-06-15T15:00:00+05:30",
    timezone: "Asia/Kolkata",
  }),
});

// Recurring schedule (fires monthly)
await blueMq.request("/schedules", {
  method: "POST",
  body: JSON.stringify({
    type: "recurring",
    template_key: "fee_reminder",
    data_source_url: "https://your-app.com/api/bluemq/fee-data",
    data_source_secret: "your-hmac-secret",
    audience: { group: "all_students" },
    frequency: "monthly",
    day_of_month: 1,
    time_of_day: "09:00",
    timezone: "Asia/Kolkata",
  }),
});
```

### 20.3 Implementing the data_source_url Endpoint

Your app must expose an endpoint that BlueMQ calls at execution time.

#### Node.js / Express

```js
const crypto = require("crypto");

function verifyBlueMQSignature(secret, body, signature) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

app.post("/api/bluemq/fee-data", (req, res) => {
  const sig = req.headers["x-bluemq-signature"]?.replace("sha256=", "");
  if (
    !sig ||
    !verifyBlueMQSignature(
      process.env.BLUEMQ_WEBHOOK_SECRET,
      JSON.stringify(req.body),
      sig,
    )
  ) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const { schedule_id, template_key } = req.body;
  // Query your database for recipients
  const students = getStudentsWithPendingFees();

  res.json({
    notifications: students.map((s) => ({
      user_id: s.id,
      title: "Fee Reminder",
      body: `Hi ${s.name}, your fee of ₹${s.amount} is due.`,
      channels: ["push", "email", "in_app"],
      user: {
        email: s.email,
        phone: s.phone,
        fcm_token: s.fcm_token,
      },
      metadata: { fee_id: s.fee_id, amount: s.amount },
      action_url: s.action_url,
    })),
  });
});
```

#### Laravel (PHP)

```php
Route::post('/api/bluemq/fee-data', function (Request $request) {
    $signature = str_replace('sha256=', '', $request->header('x-bluemq-signature'));
    $expected = hash_hmac('sha256', $request->getContent(), config('services.bluemq.webhook_secret'));

    if (!hash_equals($expected, $signature)) {
        return response()->json(['error' => 'Invalid signature'], 401);
    }

    $students = Student::whereHas('pendingFees')->get();

    return response()->json([
        'notifications' => $students->map(fn ($s) => [
            'user_id' => $s->id,
            'title' => 'Fee Reminder',
            'body' => "Hi {$s->name}, your fee of ₹{$s->pending_amount} is due.",
            'channels' => ['push', 'email', 'in_app'],
        'user' => [
          'email' => $s->email,
          'phone' => $s->phone,
          'fcm_token' => $s->fcm_token,
        ],
            'metadata' => ['fee_id' => $s->fee_id],
        'action_url' => $s->action_url,
        ])
    ]);
});
```

#### Django (Python)

```python
import hmac, hashlib, json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def bluemq_fee_data(request):
    signature = request.headers.get('x-bluemq-signature', '').replace('sha256=', '')
    expected = hmac.new(
        settings.BLUEMQ_WEBHOOK_SECRET.encode(),
        request.body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return JsonResponse({'error': 'Invalid signature'}, status=401)

    students = Student.objects.filter(has_pending_fees=True)
    return JsonResponse({
        'notifications': [
            {
                'user_id': str(s.id),
                'title': 'Fee Reminder',
                'body': f'Hi {s.name}, your fee of ₹{s.pending_amount} is due.',
                'channels': ['push', 'email', 'in_app'],
          'user': {
            'email': s.email,
            'phone': s.phone,
            'fcm_token': s.fcm_token,
          },
                'metadata': {'fee_id': str(s.fee_id)},
          'action_url': s.action_url,
            }
            for s in students
        ]
    })
```

### 20.4 Response Contract

Your `data_source_url` endpoint MUST return:

```json
{
  "notifications": [
    {
      "user_id": "string (required)",
      "title": "string",
      "body": "string",
      "channels": ["push", "email", "in_app"],
      "user": {
        "email": "string",
        "phone": "string",
        "fcm_token": "string"
      },
      "variables": {},
      "metadata": {},
      "data": {},
      "action_url": "string",
      "entity_id": "string",
      "parent_entity_id": "string"
    }
  ]
}
```

Include the `user` fields required by the channels you request (email/phone/tokens). These fields are passed through to the workers.

If templates exist for `template_key + channel`, BlueMQ renders them using `variables` and uses the rendered content for delivery. When no template exists, BlueMQ falls back to `title`/`body` (or variables-based defaults).

Returning an empty array `{ "notifications": [] }` is valid and treated as success.

All requests have an 8-second timeout. If your endpoint does not respond within 8 seconds, BlueMQ treats it as a failure and increments the retry counter.

### 20.5 Schedule Settings

Configure defaults via the dashboard (Settings → Scheduled Notifications) or API:

```bash
# Get current settings
curl -H 'x-api-key: YOUR_KEY' https://your-bluemq.com/settings/schedule

# Update settings
curl -X PATCH -H 'x-api-key: YOUR_KEY' -H 'content-type: application/json' \
  -d '{"max_retries": 5, "default_timezone": "Asia/Kolkata"}' \
  https://your-bluemq.com/settings/schedule
```

### 20.6 Go-Live Checklist for Schedules

- [ ] `data_source_url` endpoint deployed and HMAC verification working
- [ ] `data_source_secret` stored securely (never logged)
- [ ] Endpoint responds within 8 seconds under load
- [ ] Empty notifications array `[]` is handled gracefully
- [ ] Schedule created via API or dashboard and status is `active`
- [ ] Test with manual trigger (`POST /schedules/:id/trigger`) before relying on auto-poll
- [ ] Execution logs reviewed via dashboard or `GET /schedules/:id/logs`

---

## 21. Quota System

BlueMQ enforces per-channel notification rate limits per owner (coaching center / parent entity). See `docs/quotas.md` for full reference.

### 21.1 Overview

- **Owner** = `parent_entity_id` if provided, else `entity_id`.
- **Profiles** define per-channel limits (e.g., 5,000 push/month).
- **Owner Quota** assigns a profile (and optional channel-level overrides) to a specific owner.
- Quota is reserved atomically at enqueue time and settled (consumed or released) in the worker transaction.

### 21.2 Required Fields When Quotas Are Configured

If your app has any quota profiles or owner_quota rows, `entity_id` (or `parent_entity_id`) is **required** on every `/notify` call. The API returns `HTTP 400` otherwise.

### 21.3 Partial Acceptance

If only some channels exceed quota, the accepted channels are enqueued and the response includes `blocked_quota`. If all channels are blocked, `HTTP 429` is returned.

### 21.4 Quota API (Dashboard / Admin)

All routes require `x-api-key` and are scoped to the calling application.

| Method | Path                                  | Description                                                                                                                     |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/quota/profiles`                     | List profiles, includes `owner_count` per profile                                                                               |
| POST   | `/quota/profiles`                     | Create profile (`{ name, is_default }`)                                                                                         |
| PUT    | `/quota/profiles/:id`                 | Update profile (`{ name, is_default }`)                                                                                         |
| DELETE | `/quota/profiles/:id`                 | Delete profile (409 if default; 409 if assigned owners unless `?reassign_to=<id>`)                                              |
| POST   | `/quota/profiles/:id/limits`          | Upsert channel limit (`{ channel, limit_count, period }`)                                                                       |
| DELETE | `/quota/profiles/:id/limits/:channel` | Remove channel limit                                                                                                            |
| GET    | `/quota/owners`                       | List owners with search (`q`), pagination (`page`, `limit`), filter (`profile_id`), returns label & highest utilization         |
| GET    | `/quota/owners/:ownerId`              | Effective limits per channel with source (`override`, `profile`, `default_profile`, `none`), used/reserved/remaining/pct/status |
| PUT    | `/quota/owners/:ownerId`              | Upsert owner quota (`{ profile_id, label, overrides }`)                                                                         |
| DELETE | `/quota/owners/:ownerId`              | Remove owner quota assignment                                                                                                   |
| POST   | `/quota/owners/bulk`                  | Bulk assign up to 500 owners (`{ owner_ids: [...], profile_id, overrides, label }`) in a single transaction                     |
| GET    | `/quota/owners/:ownerId/branches`     | Per-branch (`entity_id`) channel usage for current period                                                                       |
| GET    | `/quota/usage`                        | Current period usage counters                                                                                                   |
| GET    | `/quota/thresholds`                   | Recent threshold alert events (80% / 100%)                                                                                      |

### 21.5 Owner-Scoped Read APIs (`/entities`)

Customer-app read APIs for tenant portals (e.g. coaching center dashboards). Strictly scoped to the app of the API key and owner hierarchy (`parent_entity_id = ownerId` or fallback `entity_id = ownerId`).

#### Endpoints

- `GET /entities/:ownerId/quota` — Effective limits + period dates. Optional `?include=thresholds`. For unlimited channels, returns `sent_count` from `notification_logs`.
- `GET /entities/:ownerId/stats` — Delivery stats. Parameters: `from`, `to`, `channel`, `type`, `entity_id`, `group_by=day|channel|type|branch`.
- `GET /entities/:ownerId/notifications` — Cursor-paginated notifications (`limit` default 50, max 200). Filters: `from`, `to`, `channel`, `status`, `type`, `entity_id`, `cursor`.
- `GET /entities/:ownerId/notifications/:id` — Single notification detail + delivery channel logs.

#### Security & Whitelisting Rules

These endpoints **never** expose:

- Raw `notifications.data` JSONB
- Recipient email addresses or phone numbers
- Device push tokens (FCM/OneSignal)
- Provider credentials or internal worker metadata

**Whitelisted notification fields returned:**
`id`, `type`, `title`, `message`, `action_url`, `status`, `entity_id`, `parent_entity_id`, `external_user_id`, `created_at`, `updated_at`.

### 21.6 Quota Timezone

Stored in `app_settings.quota_timezone` (default: `Asia/Kolkata`). Update via the settings API or directly in the database.

---

## 22. Webhooks

BlueMQ delivers real-time HTTP callbacks to your endpoint. See `docs/webhooks.md` for full reference.

### 22.1 Supported Events

| Event                | When                                               |
| -------------------- | -------------------------------------------------- |
| `notification.final` | All expected channels settled (sent or failed)     |
| `quota.threshold`    | Usage crosses 80% or 100% for first time in period |

### 22.2 Quick Setup

```
POST /webhooks/config
{ "url": "https://your-app.com/hook", "events": ["notification.final", "quota.threshold"] }
```

The response includes a `secret` shown **once only**. Store it immediately.

### 22.3 Signature Verification

```
x-bluemq-signature: sha256=<hmac-sha256-of-raw-body>
```

```js
const crypto = require("crypto");
function verify(secret, rawBody, sig) {
  const exp =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return (
    exp.length === sig.length &&
    crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))
  );
}
```

### 22.4 Delivery & Retry

- 5 attempts with backoff: 0 s → 30 s → 5 min → 30 min → 2 h
- `webhook_deliveries` is the source of truth (survives process restarts)
- Dashboard retry: **Webhooks → Delivery History → Retry**
- API retry: `POST /webhooks/deliveries/:id/retry`

### 22.5 Webhook API

| Method | Path                             | Description                               |
| ------ | -------------------------------- | ----------------------------------------- |
| GET    | `/webhooks/config`               | Get config (no secret)                    |
| POST   | `/webhooks/config`               | Create/replace (returns secret once)      |
| PATCH  | `/webhooks/config`               | Update URL/events/is_active/rotate_secret |
| DELETE | `/webhooks/config`               | Remove                                    |
| GET    | `/webhooks/deliveries`           | List delivery history                     |
| GET    | `/webhooks/deliveries/:id`       | Full delivery details                     |
| POST   | `/webhooks/deliveries/:id/retry` | Reset and retry                           |

---

## 23. Rich Notification Payload Contract

The `/notify` endpoint accepts a rich payload that is passed through to workers as-is in the `data` JSONB column. No normalizer is required; include any fields your templates or downstream consumers need.

### 23.1 Full Payload Example

```json
{
  "userId": "f604bdf3-4765-426f-b53d-3b2c69df7162",
  "type": "attendance_marked",
  "channels": ["push", "inapp"],
  "variables": {
    "subject": "Physics",
    "class_name": "Physics Intermediate",
    "branch_name": "Main Campus",
    "student_name": "Bhavesh",
    "teacher_name": "Ranjeet Kumar",
    "attendance_date": "2026-09-29",
    "late_by_minutes": "0",
    "attendance_status": "PRESENT",
    "coaching_center_name": "TheBlueBe",
    "action_url": "/lms/student/...",
    "actionUrl": "/lms/student/..."
  },
  "user": {
    "email": "user@example.com",
    "phone": "+919999999999",
    "fcmToken": "firebase-device-token"
  },
  "actionUrl": "/lms/student/...",
  "entityId": "branch-uuid",
  "parentEntityId": "coaching-center-uuid"
}
```

### 23.2 Field Mapping

| Payload Field                         | DB Column                   | Notes                                                   |
| ------------------------------------- | --------------------------- | ------------------------------------------------------- |
| `userId` / `user_id`                  | `external_user_id`          | Required                                                |
| `type`                                | `type`                      | Required, maps to template                              |
| `channels`                            | `expected_channels` (array) | Required                                                |
| `entity_id` / `entityId`              | `entity_id`                 | Branch UUID                                             |
| `parent_entity_id` / `parentEntityId` | `parent_entity_id`          | Coaching center UUID (subscription owner / quota owner) |
| `variables`                           | Passed to template renderer | All template placeholders                               |
| `user.fcmToken`                       | Job payload for push worker | Also accepted as `fcm_token`, `push_token`              |
| `data`                                | `data` JSONB                | Arbitrary context                                       |
| `action_url` / `actionUrl`            | `action_url`                | Deep link                                               |
| `sender_id` / `platform`              | `data` JSONB                | Pass-through, no separate column                        |

---

## 24. `POST /notify/batch`

> **Upcoming** — use `/notify` in a loop for now. The `/notify/batch` endpoint accepts `recipients[]` and reserves quota once for the whole batch in alphabetical channel order, distributing accepted slots to recipients in deterministic order.

---

## 25. entity_id → parent_entity_id Consistency Guard

The `entity_parent_map` table records the first `(entity_id, parent_entity_id)` pairing seen per app. All subsequent calls must use the same pairing.

**If the pairing changes, the API returns `HTTP 409`:**

```json
{
  "error": "entity_id \"branch-north\" was previously registered under parent_entity_id \"coaching-center-a\". Cannot change parent to \"coaching-center-b\" via the notify path."
}
```

This prevents accidental re-parenting and protects quota integrity.

---

## 26. notification.final Detection

The `expected_channels` column on `notifications` records every channel that was accepted and enqueued. After each terminal settle (success, non-retryable failure, or exhausted retries), the worker checks whether all expected channels now have a terminal `notification_logs` entry. If yes, `notification.final` is enqueued into `webhook_deliveries`.

The query used:

```sql
SELECT DISTINCT channel FROM notification_logs
WHERE notification_id = $1
  AND status IN ('sent', 'failed', 'permanently_failed');
```

All expected channels must appear in this set.

---

## 27. Go-Live Checklist for Quotas & Webhooks

### Quotas

- [ ] At least one quota profile created via `/quota/profiles`
- [ ] Owners assigned to profiles via `/quota/owners/:ownerId`
- [ ] `quota_timezone` set correctly in `app_settings`
- [ ] All `/notify` calls include `entity_id` or `parent_entity_id`
- [ ] Tested partial-acceptance response (`blocked_quota` field in response)
- [ ] Threshold events verified via `/quota/thresholds`

### Webhooks

- [ ] Endpoint deployed and reachable via HTTPS
- [ ] Secret stored securely (env variable, secrets manager)
- [ ] Signature verification implemented and tested
- [ ] Endpoint responds within 15 seconds
- [ ] Endpoint returns 2xx for all accepted deliveries
- [ ] Delivery history reviewed via dashboard or `/webhooks/deliveries`
- [ ] At least one manual retry tested via dashboard
- [ ] `notification.final` handler idempotent (keyed on `x-bluemq-delivery-id`)
