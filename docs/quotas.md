# Quota System — Developer Guide

## Overview

BlueMQ's quota system lets you limit how many notifications a given **owner** (coaching center, parent entity, or any tenant) can receive per channel per period. Quota enforcement happens _before_ the BullMQ job is enqueued, so blocked notifications never reach the provider.

---

## Concepts

| Term | Description |
|---|---|
| **Owner** | The entity that "owns" quota: `parent_entity_id` if present, else `entity_id`. |
| **Profile** | A named set of per-channel limits (e.g., "Standard Plan"). |
| **Owner Quota** | Assigns a profile (and optional overrides) to a specific owner. |
| **Period** | `monthly` (first of month) or `daily` (current date) in the configured timezone. |
| **Reservation** | A locked-in unit deducted from `reserved` at enqueue time. |
| **Settlement** | Converting a reservation to `consumed` (sent) or `released` (failed). |

---

## Timezone

The global quota timezone is stored in `app_settings`:

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

### List profiles
```
GET /quota/profiles
Authorization: x-api-key <key>
```

### Create a profile
```
POST /quota/profiles
{ "name": "Standard Plan", "is_default": true }
```

### Add / update a channel limit on a profile
```
POST /quota/profiles/:profileId/limits
{ "channel": "push", "limit_count": 5000, "period": "monthly" }
```

Supported channels: `push`, `email`, `sms`, `whatsapp`, `inapp`, `call`

### Remove a channel limit
```
DELETE /quota/profiles/:profileId/limits/:channel
```

### Delete a profile
```
DELETE /quota/profiles/:profileId
```

---

## Owner Quota API

### Assign a profile to an owner
```
PUT /quota/owners/:ownerId
{
  "profile_id": "uuid-of-profile",
  "overrides": {
    "push": { "limit": 200, "period": "daily" }
  }
}
```

`overrides` is a JSONB map `{ channel: { limit, period } }` and take precedence over the profile limits.

### List all owner quotas
```
GET /quota/owners
```

### Remove owner quota
```
DELETE /quota/owners/:ownerId
```

---

## Usage & Monitoring

### Current period usage
```
GET /quota/usage?owner_id=&channel=&period_start=
```

Response:
```json
{
  "usage": [
    {
      "owner_id": "coaching-abc",
      "channel": "push",
      "period_start": "2026-10-01",
      "used": 1234,
      "reserved": 5,
      "total_committed": 1239,
      "limit": 5000,
      "period": "monthly"
    }
  ]
}
```

### Threshold events (80 % and 100 %)
```
GET /quota/thresholds?owner_id=&channel=&limit=50
```

---

## How It Works End-to-End

### Reserve (at enqueue time)

1. `/notify` resolves `ownerId = parent_entity_id || entity_id`.
2. If the app has quotas configured (cached for 60 s), calls `reserveForChannels()`.
3. Each channel is processed in **alphabetical order** inside a single `BEGIN/COMMIT` transaction on a dedicated pool client.
4. For each channel, an atomic `INSERT … ON CONFLICT DO UPDATE … WHERE used + reserved + units <= limit` is attempted.
5. If the `WHERE` fails (quota exceeded): the channel is blocked.
6. Partially accepted batches: blocked channels are removed from `effectiveChannels`; the response includes `blocked_quota`.
7. All channels blocked → `HTTP 429`.

> **Important:** `entity_id` (or `parent_entity_id`) is **required** when quotas are configured. The API returns `HTTP 400` otherwise.

### Settle (in worker)

After the provider call completes (success or terminal failure), the worker:

1. Opens a **dedicated pool client** (`sql.raw.connect()`).
2. Wraps `notification_logs INSERT` + `notifications UPDATE` + `settleOnClient()` in one `BEGIN/COMMIT`.
3. `settleOnClient('consumed')` → `reserved--`, `used++`
4. `settleOnClient('released')` → `reserved--` (no charge)

### Stale cleanup

The `quota-stale` worker runs every **5 minutes** and releases reservations that:
- Are still in `reserved` status
- Have been reserved longer than `quota_stale_reservation_timeout_minutes` (default 60 min)
- Belong to a notification in a final state (`delivered`, `partial`, `failed`)

---

## entity_id → parent_entity_id Consistency

The `entity_parent_map` table enforces that an `entity_id` always maps to the same `parent_entity_id`. On first sight the mapping is recorded. On subsequent calls, if the `parent_entity_id` differs, the notify API returns `HTTP 409`.

---

## Per-`parentEntityId` Quota Configuration

Quota is keyed by `owner_id = parent_entity_id` (e.g., the coaching center UUID that owns the subscription). This means:
- Each coaching center (parent entity) has its own quota bucket.
- Multiple branches (`entity_id`) under the same coaching center share that quota.

To configure per-coaching-center limits, use `PUT /quota/owners/:parentEntityId`.

