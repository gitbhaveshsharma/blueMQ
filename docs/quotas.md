# Quota System — Developer Guide

## Overview

BlueMQ's quota system lets you limit how many notifications a given **owner**
(a tenant — e.g., the entity passed as `parent_entity_id`) can receive per
channel per period. Quota enforcement happens _before_ the BullMQ job is
enqueued, so blocked notifications never reach the provider.

> **Generic**: BlueMQ never hardcodes "coaching center" logic. An owner is
> whatever the customer app sends as `parent_entity_id` (falling back to
> `entity_id`).

---

## Concepts

| Term | Description |
|---|---|
| **Owner** | The entity that "owns" quota: `parent_entity_id` if present, else `entity_id`. |
| **Profile** | A named set of per-channel limits (e.g., "Standard Plan"). |
| **Owner Quota** | Assigns a profile + optional per-channel overrides + optional label to a specific owner. |
| **Override** | An owner-specific limit that takes precedence over the profile limit for one channel. |
| **Label** | Optional human-readable display name for an owner (stored in `owner_quota.label`). |
| **Period** | `monthly` (first of month) or `daily` (current date) in the configured timezone. |
| **Reservation** | A locked-in unit deducted from `reserved` at enqueue time. |
| **Settlement** | Converting a reservation to `consumed` (sent) or `released` (failed). |

### Limit resolution order

For any (owner, channel), the effective limit is resolved in this priority:
1. **Override** — `owner_quota.overrides[channel].limit`
2. **Profile** — `quota_profile_limits` for the owner's assigned profile
3. **Default profile** — `quota_profile_limits` for the app's `is_default=true` profile
4. **None** — channel is unlimited

---

## Timezone

```sql
SELECT value FROM app_settings WHERE key = 'quota_timezone';
-- Default: 'Asia/Kolkata'
```

To change it:
```sql
UPDATE app_settings SET value = 'UTC' WHERE key = 'quota_timezone';
```

---

## Quota Profiles API

### List profiles (includes owner_count)
```
GET /quota/profiles
Authorization: x-api-key <key>
```
Response includes `owner_count` per profile (number of owners currently assigned).

### Create a profile
```
POST /quota/profiles
{ "name": "Standard Plan", "is_default": true }
```

### Update a profile
```
PUT /quota/profiles/:profileId
{ "name": "Premium Plan", "is_default": false }
```

### Delete a profile
```
DELETE /quota/profiles/:profileId
DELETE /quota/profiles/:profileId?reassign_to=<otherProfileId>
```

**Guards:**
- `409 DEFAULT_PROFILE` — cannot delete the default profile (set another as default first).
- `409 OWNERS_ASSIGNED` — profile has owners assigned; provide `?reassign_to=<id>` to reassign them atomically before deletion.

### Add / update a channel limit on a profile
```
POST /quota/profiles/:profileId/limits
{ "channel": "push", "limit_count": 5000, "period": "monthly" }
```

Supported channels: `push`, `email`, `sms`, `whatsapp`, `inapp`, `call`

> A `limit_count` of **0** fully blocks that channel for owners on this profile.
> Channels with **no limit row** are **unlimited**.

### Remove a channel limit
```
DELETE /quota/profiles/:profileId/limits/:channel
```

---

## Owner Quota API

### List owners (search, pagination, filter)
```
GET /quota/owners
GET /quota/owners?q=academy&profile_id=<uuid>&page=2&limit=20
```

Response fields per owner:
- `owner_id`, `label`, `profile`, `overrides`, `override_count`
- `highest_utilization` — max `used/limit` % across all limited channels this period

### Get owner detail (effective limits)
```
GET /quota/owners/:ownerId
```

Response:
```json
{
  "owner": { "owner_id": "...", "label": "Apex Academy", "profile": {...} },
  "effective_limits": [
    {
      "channel": "email",
      "source": "override",   // override | profile | default_profile | none
      "limit": 500,
      "period": "monthly",
      "period_start": "2026-10-01",
      "period_end": "2026-10-31",
      "used": 120,
      "reserved": 5,
      "remaining": 375,
      "percentage": 24,
      "status": "healthy"     // healthy | warning (≥80%) | exceeded (≥100%)
    }
  ]
}
```

### Assign / update an owner
```
PUT /quota/owners/:ownerId
{
  "profile_id": "uuid",
  "label": "Apex Academy",
  "overrides": {
    "email": { "limit": 500, "period": "monthly" }
  }
}
```

- `profile_id` must belong to the calling app.
- Override channels must be from the known channel list.
- `label` is optional; stored for display in the dashboard.

### Remove an owner
```
DELETE /quota/owners/:ownerId
```

### Bulk assign owners
```
POST /quota/owners/bulk
{
  "owner_ids": ["uuid1", "uuid2", ...],   // max 500
  "profile_id": "uuid",
  "overrides": {},
  "label": null
}
```

Returns per-owner `success/error` plus a summary. Runs in a single transaction.

### Per-branch (entity) usage
```
GET /quota/owners/:ownerId/branches
```

Returns per-`entity_id` channel usage for the current month, derived from `quota_reservations`.

---

## Owner-Scoped Customer App APIs (`/entities`)

These endpoints are scoped to the **calling app's API key**. An app can only
see its own owners' data. **No sensitive data is ever returned** (no `data`
JSONB, no email/phone, no push tokens, no provider credentials).

### Effective limits
```
GET /entities/:ownerId/quota
GET /entities/:ownerId/quota?include=thresholds
```

### Delivery stats
```
GET /entities/:ownerId/stats
GET /entities/:ownerId/stats?from=2026-10-01&to=2026-10-31&group_by=channel
```

`group_by` options: `day` | `channel` | `type` | `branch`

### Notifications (cursor paginated)
```
GET /entities/:ownerId/notifications?limit=50&cursor=<token>
GET /entities/:ownerId/notifications?channel=email&status=sent&from=2026-10-01
```

Whitelisted fields: `id`, `type`, `title`, `message`, `action_url`, `status`,
`channel`, `created_at`, `external_user_id`, `entity_id`, `parent_entity_id`.

**Never returned:** `data` JSONB, email addresses, phone numbers, push tokens,
provider API credentials.

### Single notification
```
GET /entities/:ownerId/notifications/:id
```

---

## Stale Reservation Cleanup

The `quota-stale` worker runs every 5 minutes and releases reservations that:

1. Are still `reserved` past the `quota_stale_reservation_timeout_minutes` app setting (default: 60 min).
2. Belong to a notification in a terminal state (`delivered`, `partial`, `failed`).
3. **OR** belong to a notification that is still `pending` past the timeout — meaning the BullMQ job was evicted from Redis (OOM, restart) and will never run.

Case 3 also marks the orphaned notification as `failed` so it does not get found again on the next sweep.

---

## Performance Notes

### Pool warm-up (Part C fix)

**Symptom:** Requests taking ~2.2–2.4s when "New client connected to pool" appears in logs vs ~0.55s on warm connections.

**Root cause:** `pg.Pool` defaulted to `min: 0` — no connections pre-established. Every cold start paid the full Neon TCP handshake + TLS + PG auth cost (~2s).

**Fix applied (`src/db/index.js`):**
- `min: 2` — pool maintains 2 pre-connected sockets
- `socket.setKeepAlive(true, 30_000)` — TCP keep-alives prevent Neon from dropping idle connections
- `warmPool()` called at server startup — blocks until the 2 sockets are auth'd and idle in the pool before the HTTP server starts listening

After this change, the first request sees the pre-warmed socket and takes ~0.55s instead of ~2.4s.

---

## Hardening Notes

### Webhook delivery deduplication (Part D fix)

**Symptom:** Multiple concurrent workers calling `_maybeFireNotificationFinal` for the same notification could both pass the "all channels settled?" check at the same time, resulting in two `notification.final` webhook deliveries.

**Fix applied (Migration 020 + `webhook-delivery.worker.js`):**
- `CREATE UNIQUE INDEX idx_webhook_deliveries_dedup ON webhook_deliveries (app_id, event_type, COALESCE(notification_id, '00000000-...')) WHERE status IN ('pending', 'delivered')`
- `enqueueWebhookEvent` now uses `ON CONFLICT DO NOTHING` — second concurrent insert is silently ignored

### Retry logic for notification_logs

Verified correct: the `failed` event handler in `base.worker.js` only writes `permanently_failed` when `job.attemptsMade >= maxAttempts`. Transient retries are logged as `'failed'` status in the handler block inside the job processor, before throwing to let BullMQ retry. The BullMQ `failed` event fires after every attempt but only acts on the final one. **No change needed.**

---

## Database Schema (quota tables)

| Table | Purpose |
|---|---|
| `quota_profiles` | Named limit templates |
| `quota_profile_limits` | Per-channel limits per profile |
| `owner_quota` | Maps owner → profile + overrides + label |
| `quota_usage` | Running `used` / `reserved` counters per (owner, channel, period) |
| `quota_reservations` | One row per (notification, channel) reservation |
| `quota_threshold_events` | Fired when usage crosses 80% / 100% thresholds |

### Migrations applied

| Migration | Contents |
|---|---|
| `018_quota_and_webhooks.sql` | Initial quota schema |
| `019_owner_quota_label_indexes.sql` | `owner_quota.label` column; entity_id + notification_logs indexes |
| `020_webhook_delivery_hardening.sql` | Dedup unique index + poll index on `webhook_deliveries` |

---

## Running Tests

```bash
# Integration tests (requires DATABASE_URL in .env)
node --test src/tests/quota-api.test.js

# Or add to package.json scripts:
# "test:quota": "node --test src/tests/quota-api.test.js"
```
