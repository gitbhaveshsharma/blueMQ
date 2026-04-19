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
- whatsapp: user.phone plus entity_id or parent_entity_id context
- in_app: no external provider identity needed beyond user_id

### 6.2 WhatsApp edge handling

If whatsapp is requested without entity_id and parent_entity_id:

- WhatsApp is removed from effective delivery if other channels remain.
- Request fails with 400 only if WhatsApp was the only channel.

### 6.3 Template resolution in notify

Notify loads templates using:

- app_id + type + channel + is_active=true

When template is missing, notify generates fallback payload:

- title: variables.title or type (underscores replaced)
- body: variables.body or variables.message or Notification for the type value
- ctaText: variables.cta_text or null

## 7. API Contract: Templates

Endpoints:

- GET /templates
- POST /templates
- PUT /templates/:id
- DELETE /templates/:id

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
- GET /whatsapp/sessions
- GET /whatsapp/sessions/:entity_id
- POST /whatsapp/sessions/:entity_id/test-message
- DELETE /whatsapp/sessions/:entity_id

Create/update payload fields:

- entity_id (required)
- parent_entity_id (optional)
- connection_type (must be meta if provided)
- meta_api_key (required)
- meta_phone_number_id (required)
- meta_business_account_id (optional)

Behavior:

- Session lookup supports one-level parent fallback.
- GET single returns resolved_entity_id and is_inherited.
- DELETE marks disconnected and clears stored meta_api_key.
- test-message validates phone as digits-only, 7-15 length.

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
  constructor(private baseUrl: string, private apiKey: string) {}

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
      throw new Error(body.error || `BlueMQ request failed: ${response.status}`);
    }

    return body as T;
  }

  async notify(payload: BlueMqNotifyRequest) {
    return this.request<{ success: boolean; notification_id: string; channels_enqueued: string[] }>(
      "/notify",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }
}
```

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
