# Audiences

Audiences are reusable recipient groups owned by one BlueMQ app. Audience IDs
and member IDs are generated UUIDs. Listing audiences returns metadata and a
member count; members are loaded separately so large audiences do not slow down
the list or Send page.

## Dashboard pages

- `/audiences` lists audiences with member counts and search.
- `/audiences/new` is the dedicated create page.
- `/audiences/:audienceId` is the dedicated page for one audience: details,
  add/edit/delete members, paginated member list, and import/export.
- The same editor is also available as a right-side sheet, opened from the
  audience list (quick edit) and from the Send page, so an audience can be
  created and filled without leaving a send in progress. The sheet links to the
  full page.

## Member fields

Audience imports, exports and member forms use only:

| Field | Purpose |
| --- | --- |
| `email` | Email delivery address |
| `phone` | SMS or WhatsApp number in E.164 format |
| `fcm_token` | Firebase push token |
| `onesignal_player_id` | OneSignal subscription/player ID |
| `entity_id` | WhatsApp entity/session for this member |

At least one delivery address (`email`, `phone`, `fcm_token`, or
`onesignal_player_id`) is required. `entity_id` alone is not a delivery address.
An internal `user_id` is generated automatically.

## Import and export

Supported formats are CSV and JSON. CSV uses this exact header:

```csv
email,phone,fcm_token,onesignal_player_id,entity_id
,,,,
```

JSON is an array containing the same fields:

```json
[
  {
    "email": "",
    "phone": "",
    "fcm_token": "",
    "onesignal_player_id": "",
    "entity_id": ""
  }
]
```

CSV follows RFC 4180 quoting rules. Imports default to `append`; `replace`
removes existing members in the same transaction before inserting valid rows.
One import accepts at most 50,000 rows. Results report imported and skipped
counts plus up to 100 row errors.

## API

All routes require the normal app API key and are scoped to that app.

### Audience metadata

- `GET /audiences`
- `GET /audiences/:id`
- `POST /audiences` with `{ "name": "...", "description": "..." }`
- `PUT /audiences/:id` with name and/or description
- `DELETE /audiences/:id`

### Members

- `GET /audiences/:id/members?page=1&limit=50`
- `POST /audiences/:id/members`
- `PUT /audiences/:id/members/:memberId`
- `DELETE /audiences/:id/members/:memberId`
- `POST /audiences/:id/members/import`
- `GET /audiences/:id/members/export?format=csv`
- `GET /audiences/:id/members/export?format=json`

Import uses `multipart/form-data`: attach the CSV or JSON as `file` and
optionally send `mode=append` or `mode=replace`. The file-size limit defaults
to 10 MB and can be configured with `AUDIENCE_IMPORT_MAX_BYTES` (up to 25 MB).

## Sending

### Single recipient: `POST /notify`

The existing `/notify` route and contract are unchanged. It still requires
`user_id`, `type`, a non-empty `channels` array, and a `user` delivery-address
object.

### Audience: `POST /audiences/:id/notify`

Use the audience broadcast route instead of calling `/notify` once per member:

```json
{
  "type": "notification_type",
  "channels": ["email", "whatsapp"],
  "variables": {},
  "entity_id": "optional-whatsapp-fallback",
  "parent_entity_id": "optional-parent-fallback"
}
```

The member's `entity_id` takes precedence over the request fallback. The server
reads members in pages and enqueues bounded concurrent jobs. A `202` response
means delivery jobs were queued, not delivered:

```json
{
  "success": true,
  "broadcast": true,
  "audience_id": "uuid",
  "queued": 100,
  "skipped": 0,
  "errors": []
}
```

`AUDIENCE_BROADCAST_CONCURRENCY` controls bounded server fan-out (default 10,
minimum 1, maximum 50).
