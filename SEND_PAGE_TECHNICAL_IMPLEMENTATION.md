# Send Page Technical Implementation Guide

This document describes how `frontend/src/pages/SendPage.jsx` works today and
what another frontend or product surface must implement to reproduce the same
behavior.

The important design boundary is:

- The Send page collects the notification type, channels, recipient context,
  template variables, and optional schedule settings.
- The immediate-send backend selects the persisted template by `type` and
  `channel`, renders it with `variables`, and enqueues one job per channel.
- The editor's channel body is useful for preview and variable discovery, but
  it is not sent as a per-request template override by the current
  `/notify` contract.

## 1. User Flow

### 1.1 Page initialization

On mount, the page loads:

1. Audience metadata with `GET /audiences`.
2. Local database templates with `GET /templates`.
3. Active WhatsApp sessions with `GET /whatsapp/sessions?status=active`.
4. Cached WhatsApp templates with `GET /whatsapp-templates?source=cache&status=ALL`.
5. Template aliases with `GET /template-aliases`.

The first active WhatsApp session prefills `singleUser.entity_id` if the user
has not entered one. The field remains editable. Changing the entity reloads
the cached WhatsApp templates and aliases for that entity.

### 1.2 Notification type

The notification type is a free-text value with search suggestions. Suggestions
are built locally from:

- `templates.type` values returned by `/templates`;
- cached WhatsApp template names;
- alias `notification_type` values.

Search normalization lowercases the text and treats punctuation and underscores
as separators. Results are ranked by exact match, prefix match, substring match,
token match, and finally subsequence match.

Selecting a suggestion only sets `notifType`. It does not send a template ID or
template body to the backend.

### 1.3 Recipient selection

The recipient mode is either `single` or `audience`.

#### Single user

Required:

- `user_id`

Optional delivery addresses:

- `email`
- `phone`
- `fcm_token`
- `onesignal_player_id`

Optional WhatsApp routing context:

- `entity_id`
- `parent_entity_id`

The page validates only `user_id` in the browser. Channel-specific delivery
requirements are enforced by the backend/provider configuration.

#### Audience

The page displays audience metadata from `GET /audiences`, including each
audience's ID, name, and member count. It does not load members while the user
is choosing an audience.

The user can:

- create or manage an audience through `AudienceManager`;
- select one audience ID;
- open the audience page.

For an immediate audience send, the page calls the dedicated broadcast route.
The server reads members in pages and invokes the same notification preparation
path for each member. A member's `entity_id` takes precedence over the request
fallback `entity_id`.

For a scheduled audience send, the current page first loads all members with
`GET /audiences/:id`, then embeds them into the schedule's `audience.members`
array. This is different from the immediate broadcast path and can create a
large schedule payload.

### 1.4 Channel selection

Supported public channel IDs are:

```text
push, email, sms, whatsapp, in_app
```

At least one channel must be selected. Each selected channel gets an expandable
content editor:

- Push and in-app: title and body.
- Email: subject, plain text or HTML body, rich text editor, preview.
- SMS: body and estimated segment count.
- WhatsApp: read-only cached Meta template preview and language selection.

The channel editor updates `channelContents[channel]`. It is not part of the
immediate `/notify` payload, so a reimplementation must either preserve the
current backend-driven model or add an explicit backend contract for custom
content.

### 1.5 Variable entry

The page scans selected channel content for placeholders matching:

```text
{{name}}
{{student_name}}
{{1}}
```

It shows the union of variables across selected channels. The user chooses:

- `Shared`: one value map used by every selected channel;
- `Per-channel`: separate values for each channel.

WhatsApp numbered placeholders are treated specially. They become the
`variables.whatsapp` array, while named variables remain top-level properties.

### 1.6 Submit and result

The submit handler validates:

1. notification type is non-empty;
2. at least one channel is selected;
3. single-user mode has `user_id`, or audience mode has an audience ID;
4. every detected WhatsApp numbered variable has a non-empty value when a
   WhatsApp template is selected.

The page then chooses either the immediate path or schedule path. Immediate
responses are displayed as queued, not delivered. Provider delivery happens
asynchronously in workers.

## 2. Immediate Send API

### 2.1 Single user

```http
POST /api/notify
x-api-key: <app-api-key>
Content-Type: application/json
```

Example request:

```json
{
  "user_id": "student_123",
  "type": "fee_due",
  "channels": ["push", "email", "whatsapp"],
  "entity_id": "center_a",
  "parent_entity_id": "org_root",
  "variables": {
    "student_name": "Rahul",
    "amount": "5000",
    "whatsapp": ["Rahul", "5000"],
    "whatsapp_language": "en_US"
  },
  "user": {
    "email": "rahul@example.com",
    "phone": "+919876543210",
    "fcm_token": "fcm-token",
    "onesignal_player_id": "player-id"
  }
}
```

Required request fields are `user_id`, `type`, `channels` (non-empty array),
and `user` (object). The page sends `variables` only when the resulting object
is non-empty.

Successful enqueue response:

```json
{
  "success": true,
  "notification_id": "uuid",
  "channels_enqueued": ["push", "email", "whatsapp"]
}
```

The response is HTTP `202`. It confirms queueing, not provider delivery.

### 2.2 Audience broadcast

```http
POST /api/audiences/:audienceId/notify
x-api-key: <app-api-key>
Content-Type: application/json
```

Example request:

```json
{
  "type": "fee_due",
  "channels": ["email", "whatsapp"],
  "variables": {
    "amount": "5000",
    "whatsapp": ["5000"]
  },
  "entity_id": "center_a",
  "parent_entity_id": "org_root"
}
```

The server:

1. verifies the audience belongs to the authenticated app;
2. reads members in pages of 500;
3. invokes `/notify` behavior for each member with bounded concurrency;
4. uses the member's `entity_id` before the request fallback;
5. returns aggregate counts.

Response shape:

```json
{
  "success": true,
  "broadcast": true,
  "audience_id": "uuid",
  "queued": 25,
  "skipped": 0,
  "errors": []
}
```

The page shows `queued` and `skipped`; it does not wait for final provider
status.

## 3. Template Selection

### 3.1 Local templates: push, email, SMS, in-app

The browser loads local templates only to populate search results and the
optional "Use existing template" picker. The actual immediate send path is:

1. Normalize requested public channels (`in_app` also accepts legacy `inapp`).
2. Resolve an alias for each channel.
3. Query active rows from `templates` by app, resolved type, and channel.
4. If variants exist, compare each row's `condition_key` and
   `condition_value` against `variables`.
5. Prefer the matching conditional variant; otherwise use the default variant.
6. Render `title`, `body`, `cta_text`, and `cta_url` with `renderTemplate`.
7. If no row exists, use the fallback title/body from `variables` or the
   notification type.

The frontend's selected title/body is therefore not authoritative for
`/notify`. To implement a truly ad-hoc compose flow, the API must be extended
to accept channel content and the backend must validate and render it.

### 3.2 WhatsApp templates

WhatsApp uses cached Meta templates, not local `templates` rows.

The page loads cache rows using:

```http
GET /api/whatsapp-templates?entity_id=<entity>&source=cache&status=ALL
```

The UI matches the notification type against a template name after search
normalization. If a WhatsApp alias exists, it displays and previews the alias
target. When multiple languages exist, the UI prefers the current language,
then an approved row, then the first row.

The browser stores the selected template name, language, status, preview text,
and extracted variable metadata in `channelContents.whatsapp`, but does not put
the template name in the `/notify` request. The server independently resolves:

1. WhatsApp alias for `entity_id`, then `parent_entity_id`;
2. cached sendable template by resolved name and requested language;
3. Meta template components and positional parameters;
4. plain-text fallback if no sendable cached template exists.

Only `APPROVED` is sendable as a Meta template. Pending or rejected rows are
displayed by the UI but cause the backend to use fallback behavior.

## 4. Variable Handling

### 4.1 Frontend extraction

`extractVars` accepts alphanumeric and underscore keys. `variableText` scans:

- email subject;
- channel body;
- WhatsApp's generated `templateVarsText`.

This means WhatsApp header and dynamic button variables are included when the
cache exposes them, even though the actual Meta body is read-only.

### 4.2 Frontend payload conversion

The page builds one flat variables object:

```js
{
  student_name: "Rahul",
  amount: "5000",
  whatsapp: ["first", "second"],
  whatsapp_language: "en_US"
}
```

Named keys are copied directly. Numeric keys are collected and converted into
an array from index 1 through the highest supplied index. Missing positions are
sent as empty strings. If per-channel mode is selected, values are merged in
selected-channel order; duplicate named keys are overwritten by a later
channel.

### 4.3 Backend rendering

For local templates, named placeholders are rendered into title, body, CTA
text, and CTA URL.

For WhatsApp, BlueMQ first reads the cached Meta template's example labels and
maps named consumer variables to the numbered placeholders. For example, Meta
may provide `student_name`, `class_name`, `subject`, `attendance_date`, and
`attendance_status` for `{{1}}` through `{{5}}`. BlueMQ creates the positional
array automatically.

Consumers can also provide `variables.whatsapp` or numeric keys explicitly;
explicit positional values remain authoritative for backward compatibility.
The normalized array becomes Meta component parameters. Header, body, dynamic
URL button, and copy-code parameters use the same positional sequence.
`whatsapp_language` or `language` selects the cached language.

If a required mapped value is missing, `/notify` returns HTTP 400 before a
queue job is created. Meta template cache lookup follows the same direct,
parent, then active app-fallback entity order as WhatsApp credential lookup.

## 5. Alias Resolution

Aliases map an incoming notification type to a stored template name:

```text
notification_type: fee_due
resolves_to: fee_due_v2
channel: whatsapp
entity_id: center_a
```

Alias names are validated as lowercase letters, numbers, and underscores. A
WhatsApp alias requires an entity ID and its target must already exist in the
WhatsApp cache.

At send time, non-WhatsApp aliases are app-scoped. WhatsApp aliases are checked
in this order:

1. request `entity_id`;
2. request `parent_entity_id`;
3. original notification type with no alias.

The UI's alias preview is advisory. The backend resolution must be treated as
the source of truth, especially for audience members with their own entity.

## 6. Queue and Worker Boundary

After template preparation, the backend inserts a notification row and calls
`enqueueNotification`. Each accepted channel gets a separate BullMQ job with:

- notification ID;
- app and user IDs;
- rendered title/body;
- body format and CTA;
- delivery addresses;
- entity and parent entity IDs;
- WhatsApp template name, language, and parameters when applicable.

The API can return `202` before a provider sends anything. Provider workers own
retries, provider calls, and final notification status.

## 7. Scheduling

The page exposes one-time and recurring settings:

- one-time: `run_at`;
- daily: `time_of_day`;
- weekly: `time_of_day` and `day_of_week` (`0` is Sunday);
- monthly: `time_of_day` and `day_of_month` (1-28);
- custom cron: `cron_expression`;
- timezone.

The intended schedule endpoint is:

```http
POST /api/schedules
```

However, the current page does not provide the complete schedule contract. It
sends empty `data_source_url` and `data_source_secret`, while the backend
requires both fields. It also does not include a schedule-level `channels`
field or a persisted schedule `variables` field in the schedule insert path.
The backend schedule worker expects the configured `data_source_url` to return:

```json
{
  "notifications": [
    {
      "user_id": "student_123",
      "channels": ["email"],
      "variables": { "student_name": "Rahul" },
      "user": { "email": "rahul@example.com" }
    }
  ]
}
```

Therefore, scheduled sends from this page currently fail validation at
`POST /schedules` because the required data-source fields are empty. Before
reusing this flow, choose one of these designs:

1. Require a real signed data source URL and secret, then have that source
   return recipient-specific notifications at execution time.
2. Add a static schedule contract containing channels, recipients, and base
   variables, and update the schedule API/worker to persist and execute it.

Do not treat the current empty data-source fields as a valid static schedule
implementation.

## 8. Review Findings and Reimplementation Guidance

### High priority

1. **Channel composition is not transmitted.** `channelContents` never appears
   in the immediate single-user or audience request. The page can show a body
   that differs from what `/notify` selects. Either rename this UI as template
   selection/preview, or add a server-supported custom-content payload.

2. **Scheduled submit is incompatible with the backend contract.** The page
   sends empty `data_source_url` and `data_source_secret`, but the route rejects
   empty values. The schedule UI needs a real data-source configuration or the
   backend needs a static schedule mode.

3. **Schedule form state is not fully represented.** Selected channels and
   channel content are absent from `schedulePayload`. Even after satisfying the
   required URL/secret fields, the current schedule cannot reproduce the
   immediate-send selection without additional backend support.

### Medium priority

4. **Audience scheduled sends eagerly embed all members.** This is simple but
   does not scale like the immediate broadcast path. Prefer storing an audience
   ID and resolving members at execution time, or enforce a payload/member
   limit.

5. **Single-user scheduled sends omit `onesignal_player_id`.** Immediate sends
   include it, but the scheduled `userObj` does not. OneSignal push delivery
   can therefore behave differently between immediate and scheduled sends.

6. **The frontend WhatsApp match is advisory and entity-sensitive.** The UI
   reloads templates when the single-user entity changes, but audience members
   can carry their own entity IDs. The server's per-member resolution is the
   correct behavior; a preview for an audience may not represent every member.

### Working behavior to preserve

- Use `/audiences/:id/notify` for immediate audience broadcasts instead of
  looping in the browser.
- Keep API authentication in the shared API client using `x-api-key`.
- Send WhatsApp numbered values as `variables.whatsapp` and language as
  `variables.whatsapp_language`.
- Treat `202` as queued, not delivered.
- Keep template alias resolution on the backend because entity and parent
  entity context can change the selected WhatsApp template.

## 9. Minimal Reimplementation Checklist

1. Load audiences and template metadata.
2. Let the user enter or select a notification type.
3. Select one or more public channels.
4. Select either a single recipient or an audience ID.
5. Collect named and positional variable values.
6. Build the flat `variables` object described above.
7. Call `POST /notify` for one user or `POST /audiences/:id/notify` for an
   audience.
8. Display queue response IDs/counts and provider errors.
9. For scheduling, implement the complete data-source contract before exposing
   the schedule action.

## 10. Source Files

- Page orchestration: `frontend/src/pages/SendPage.jsx`
- API client: `frontend/src/services/api.js`
- Immediate send route: `src/api/routes/notify.js`
- Audience route: `src/api/routes/audiences.js`
- Local templates route: `src/api/routes/templates.js`
- WhatsApp templates route: `src/api/routes/whatsapp-templates.js`
- Alias logic: `src/utils/template-alias.js`
- WhatsApp parameter logic: `src/utils/whatsapp-template.js`
- Schedule route: `src/api/routes/schedules.js`
- Queue handoff: `src/queues/enqueue.js`
- Scheduled worker: `src/workers/scheduled-notification.worker.js`
