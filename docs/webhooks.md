# Webhooks — Developer Guide

## Overview

BlueMQ can push real-time HTTP callbacks to your application when specific events occur. This allows you to react to notification outcomes without polling the API.

---

## Supported Events

| Event | Triggered when |
|---|---|
| `notification.final` | All expected channels for a notification have reached a terminal state (sent, failed, or permanently_failed). |
| `quota.threshold` | An owner's quota usage crosses 80% or 100% for the first time in a period. |

---

## Quick Start

### 1. Configure your endpoint
```
POST /webhooks/config
Authorization: x-api-key <key>
Content-Type: application/json

{
  "url": "https://your-app.com/webhooks/bluemq",
  "events": ["notification.final", "quota.threshold"]
}
```

Response (secret shown **once only**):
```json
{
  "webhook": { "app_id": "...", "url": "...", "is_active": true, "events": [...] },
  "secret": "a3f9b...hex...string",
  "_note": "Store this secret securely. It is never returned again."
}
```

**Store the secret immediately.** It cannot be retrieved again; use `PATCH /webhooks/config { "rotate_secret": true }` to generate a new one.

### 2. Verify incoming signatures

Every webhook request carries an `x-bluemq-signature` header:

```
x-bluemq-signature: sha256=<hmac-sha256-hex>
```

The HMAC is computed over the **raw request body** using your webhook secret.

#### Node.js verification
```js
const crypto = require('crypto');

function verifyBlueMQWebhook(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');

  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}

// Express handler — use raw body middleware
app.post('/webhooks/bluemq', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.headers['x-bluemq-signature'];
  if (!verifyBlueMQWebhook(process.env.BLUEMQ_SECRET, req.body.toString(), sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(req.body);
  handleEvent(event);
  res.sendStatus(200);
});
```

#### Python verification
```python
import hmac, hashlib

def verify_bluemq(secret: str, raw_body: bytes, signature: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

---

## Event Payloads

### `notification.final`
```json
{
  "event": "notification.final",
  "notification_id": "uuid",
  "status": "delivered",
  "type": "attendance_marked",
  "entity_id": "branch-uuid",
  "parent_entity_id": "coaching-center-uuid",
  "external_user_id": "user-123",
  "settled_channels": ["push", "inapp"],
  "expected_channels": ["push", "inapp"],
  "occurred_at": "2026-10-01T09:30:00.000Z"
}
```

`status` values: `delivered` (all channels sent), `partial` (some failed), `failed` (all failed).

### `quota.threshold`
```json
{
  "event": "quota.threshold",
  "app_id": "my-app",
  "owner_id": "coaching-center-uuid",
  "channel": "push",
  "threshold": 80,
  "limit": 5000,
  "used": 4012,
  "period": "monthly",
  "period_start": "2026-10-01",
  "occurred_at": "2026-10-01T14:22:05.000Z"
}
```

`threshold` is `80` (warning) or `100` (limit reached). Each fires at most once per owner/channel/period.

---

## Delivery & Retry

BlueMQ uses an **exponential backoff** schedule:

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts the delivery is marked `failed`. You can retry manually from the dashboard (**Webhooks → Delivery History → Retry**) or via API:

```
POST /webhooks/deliveries/:id/retry
```

This resets `attempts = 0` and `next_attempt_at = now()` so the worker picks it up on the next poll (≤10 s).

**`webhook_deliveries` is the source of truth.** The BlueMQ process uses a polling worker that claims rows with `FOR UPDATE SKIP LOCKED`, so multiple processes are safe without coordination.

---

## Webhook Management API

### Get current config
```
GET /webhooks/config
```

### Update URL or events
```
PATCH /webhooks/config
{ "url": "https://new-url.example.com/hook", "events": ["notification.final"] }
```

### Disable webhook temporarily
```
PATCH /webhooks/config
{ "is_active": false }
```

### Rotate secret
```
PATCH /webhooks/config
{ "rotate_secret": true }
```
Returns the new secret (shown once).

### Remove webhook
```
DELETE /webhooks/config
```

### List delivery history
```
GET /webhooks/deliveries?status=failed&event_type=notification.final&page=1&limit=50
```

### Get single delivery (with full payload)
```
GET /webhooks/deliveries/:id
```

---

## Additional Request Headers

Each webhook request includes:

| Header | Value |
|---|---|
| `x-bluemq-signature` | `sha256=<hmac>` |
| `x-bluemq-event` | e.g. `notification.final` |
| `x-bluemq-delivery-id` | UUID of the `webhook_deliveries` row |
| `Content-Type` | `application/json` |

---

## Best Practices

1. **Always verify signatures** before processing the payload.
2. **Respond quickly** (< 15 s) — BlueMQ has a 15-second HTTP timeout. Do your processing asynchronously.
3. **Return 2xx for all accepted deliveries** — even if you intend to process them later.
4. **Idempotent handlers** — a delivery may be retried. Use `x-bluemq-delivery-id` to deduplicate.
5. **Use HTTPS** — BlueMQ does not deliver to plain HTTP endpoints in production.
