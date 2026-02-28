# WAHA — WhatsApp Service for BlueMQ

## What This Is

[WAHA](https://github.com/devlikeapro/waha) (WhatsApp HTTP API) is a **self-hosted** Docker container that automates WhatsApp Web. It exposes a REST API that BlueMQ uses to send WhatsApp messages.

**Why self-hosted?** No monthly per-message fees, no Meta Business verification, no WhatsApp Business API approval process. Each coaching centre scans a QR code with their own WhatsApp number and messages go out from that number — students see a familiar, trusted sender.

**How it fits into BlueMQ:**

```
Coach scans QR → WAHA stores session → BlueMQ sends via WAHA REST API
                                         ↓
                        Student receives WhatsApp message
```

```
┌─────────────────────────────────────────────────────────────┐
│                   Railway Project                           │
│                                                             │
│  ┌─────────────────────┐     ┌────────────────────────┐    │
│  │  notification-service│────▶│   WAHA (Docker)        │    │
│  │  (BlueMQ)           │     │   devlikeapro/waha     │    │
│  │  Port 3001          │     │   Port 3000            │    │
│  └─────────────────────┘     └────────────────────────┘    │
│         │  private network: http://waha.railway.internal:3000│
│         │                                                   │
│  ┌──────┴──────┐                                           │
│  │   Redis     │                                           │
│  └─────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Railway Deployment (Step by Step)

### Step 1 — Add WAHA Service in Railway Dashboard

1. Open your Railway project (the **same project** that runs notification-service)
2. Click **"+ New Service"** (top right)
3. Click **"Docker Image"**
4. In the image field, enter: `devlikeapro/waha`
5. Click **"Add Service"**
6. Wait for the first image pull to complete (~1-2 minutes)

> Railway will pull the image and start the container. It will crash initially because we haven't set environment variables yet. That's normal.

### Step 2 — Set Environment Variables

Click the WAHA service → **Variables** tab → add these:

| Variable                  | Value                                                                                        | Notes                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `WHATSAPP_API_KEY`        | `your-strong-random-secret`                                                                  | Generate one. Same value goes into notification-service as `WAHA_API_KEY` |
| `WHATSAPP_HOOK_URL`       | `https://YOUR-NOTIFICATION-SERVICE.railway.app/whatsapp/sessions/webhook?secret=YOUR-SECRET` | Must be the **public** URL of your notification-service                   |
| `WHATSAPP_HOOK_EVENTS`    | `session.status`                                                                             | Do not change                                                             |
| `WHATSAPP_DEFAULT_ENGINE` | `WEBJS`                                                                                      | Stable engine, works on free WAHA Core                                    |
| `WAHA_LOG_LEVEL`          | `info`                                                                                       | Use `debug` for troubleshooting                                           |

**How to generate the secrets:**

```bash
# Run this twice — once for WHATSAPP_API_KEY, once for webhook secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3 — Add Persistent Volume (CRITICAL)

**Without a volume, every Railway redeploy forces ALL coaches to rescan their QR code.** Sessions are stored on disk inside the container — if the container restarts without a volume, they're gone.

1. Click the WAHA service → **Volumes** tab
2. Click **"Add Volume"**
3. Mount path: `/app/.sessions`
4. Size: **1 GB** (sufficient for hundreds of sessions)
5. Click **"Create"**

Railway will redeploy the service with the volume attached.

### Step 4 — Update notification-service Variables

Go to your **notification-service** in Railway → **Variables** tab → add/update:

| Variable              | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `WAHA_BASE_URL`       | `http://waha.railway.internal:3000`                                |
| `WAHA_API_KEY`        | Same value as `WHATSAPP_API_KEY` from Step 2                       |
| `WAHA_WEBHOOK_SECRET` | Same secret you used in the `?secret=` part of `WHATSAPP_HOOK_URL` |
| `BASE_URL`            | `https://your-notification-service.railway.app`                    |

**About Railway private networking:**

- Services in the **same Railway project** communicate via `*.railway.internal`
- notification-service calls `http://waha.railway.internal:3000` — this is internal, fast, free, and secure
- WAHA's webhook calls back via the **public** URL because webhooks originate from the WAHA container (not via private DNS for outbound)
- Never use the public URL for internal service-to-service calls

### Step 5 — Verify Deployment

1. Go to WAHA service → **Settings** → **Networking** → click **"Generate Domain"**
2. Railway gives you a URL like `https://waha-production-xxxx.up.railway.app`
3. Open: `https://waha-production-xxxx.up.railway.app/dashboard`
4. Enter your `WHATSAPP_API_KEY` value as the password
5. You should see the WAHA dashboard with zero sessions

Also check the health endpoint:

```bash
curl https://waha-production-xxxx.up.railway.app/api/server/status
# Expected: {"status":"ok"}
```

### Step 6 — Test Full Flow

Run these commands replacing the placeholder values:

**Test 1 — Create a session (get QR code):**

```bash
curl -X POST https://YOUR-NOTIFICATION-SERVICE.railway.app/whatsapp/sessions \
  -H "x-api-key: YOUR_BLUEMQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "entity_id": "test-001" }'
```

Response contains a `qr_code` field — display it as an image. Scan with WhatsApp on the coach's phone.

**Test 2 — Check session status (poll after scanning):**

```bash
curl https://YOUR-NOTIFICATION-SERVICE.railway.app/whatsapp/sessions/test-001 \
  -H "x-api-key: YOUR_BLUEMQ_API_KEY"
```

Status should change from `pending` → `active` after QR scan.

**Test 3 — Send a WhatsApp message:**

```bash
curl -X POST https://YOUR-NOTIFICATION-SERVICE.railway.app/notify \
  -H "x-api-key: YOUR_BLUEMQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "student-001",
    "entity_id": "test-001",
    "type": "fee_due",
    "channels": ["whatsapp"],
    "variables": { "student_name": "Rahul", "amount": "2000" },
    "user": { "phone": "919876543210" },
    "action_url": "https://tutrsy.com/fees"
  }'
```

**Test 4 — Delete the test session:**

```bash
curl -X DELETE https://YOUR-NOTIFICATION-SERVICE.railway.app/whatsapp/sessions/test-001 \
  -H "x-api-key: YOUR_BLUEMQ_API_KEY"
```

---

## Local Development

Run WAHA locally alongside your notification-service:

```bash
# 1. Go to the waha folder
cd waha

# 2. Copy and fill the env file
cp .env.example .env
# Edit .env — set WHATSAPP_API_KEY and WHATSAPP_HOOK_URL

# 3. Start WAHA
docker-compose up -d

# 4. WAHA is now running at http://localhost:3000
# 5. Open dashboard: http://localhost:3000/dashboard
```

In your notification-service `.env`, set:

```env
WAHA_BASE_URL=http://localhost:3000
WAHA_API_KEY=same-as-WHATSAPP_API_KEY-in-waha/.env
```

**For webhooks locally** — WAHA needs to reach your notification-service via a public URL. Use ngrok:

```bash
# In a separate terminal
ngrok http 3001

# Copy the https://xxxx.ngrok.io URL
# Set in waha/.env:
# WHATSAPP_HOOK_URL=https://xxxx.ngrok.io/whatsapp/sessions/webhook?secret=your-secret
# Then restart: docker-compose down && docker-compose up -d
```

---

## Session Lifecycle

```
    ┌─────────┐   Coach scans QR    ┌─────────┐
    │ PENDING │ ──────────────────▶  │ ACTIVE  │
    └─────────┘                      └────┬────┘
         ▲                                │
         │                                │ Phone offline /
         │ Coach rescans QR               │ logged out elsewhere
         │                                ▼
         │                          ┌──────────────┐
         └───────────────────────── │ DISCONNECTED │
                                    └──────────────┘
                                          │
                                          │ Number reported
                                          ▼
                                    ┌──────────┐
                                    │  BANNED  │
                                    └──────────┘
```

| Status         | Meaning                                     | Action                                    |
| -------------- | ------------------------------------------- | ----------------------------------------- |
| `pending`      | Session created, QR not scanned yet         | Show QR code to coach                     |
| `active`       | Connected, messages can be sent             | Normal operation                          |
| `disconnected` | Phone went offline or logged out from phone | Show "Reconnect" banner, coach rescans QR |
| `banned`       | WhatsApp banned the number                  | Use a different number                    |

**What happens on disconnect:**

1. WAHA fires a webhook → notification-service updates the DB status to `disconnected`
2. Next WhatsApp notification job finds no active session → logs failure (no retry)
3. Your app (Tutrsy) should show a "Reconnect WhatsApp" banner to the coach

---

## Troubleshooting

| Problem                                    | Cause                                     | Fix                                                                                                     |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| QR code not generating                     | WAHA not running or wrong API key         | Check Railway deployment logs. Verify `WHATSAPP_API_KEY` matches `WAHA_API_KEY` in notification-service |
| Session lost after redeploy                | No volume mounted                         | Add a persistent volume at `/app/.sessions` (Step 3)                                                    |
| Webhook not firing                         | Wrong `WHATSAPP_HOOK_URL`                 | Must be the **public** URL of notification-service. Check Railway Networking tab                        |
| WAHA unreachable from notification-service | Private networking issue                  | Both services must be in the **same Railway project**. Use `http://waha.railway.internal:3000`          |
| Messages not sending                       | Session disconnected                      | Coach must rescan QR code via your app's WhatsApp settings                                              |
| Number banned by WhatsApp                  | Sending too many messages or spam reports | Use a dedicated coaching number, not a personal one. Send only transactional messages to known students |
| WAHA dashboard won't load                  | No public domain generated                | WAHA service → Settings → Networking → Generate Domain                                                  |
| Health check failing                       | Container still starting                  | WAHA takes 15-30s to start. Wait for health check to pass                                               |

---

## Important Notes

1. **WAHA uses unofficial WhatsApp Web automation**
   - This is against WhatsApp's Terms of Service but is not illegal
   - Low ban risk when sending transactional messages to your own students/parents
   - Recommended: coaches use a **dedicated number**, not their personal one

2. **Each coaching centre scans with their OWN number**
   - Messages arrive FROM the coach's number — students see a familiar, trusted sender
   - One ban affects only that centre, not others
   - Each centre manages their own connection via your app's settings

3. **WAHA Core (free) is sufficient**
   - The free `devlikeapro/waha` image supports the `WEBJS` engine
   - This is enough for the coaching centre use case
   - WAHA Plus (paid) is only needed for the `NOWEB` engine or 500+ concurrent sessions

4. **Sessions persist via Railway volume**
   - Container restarts do **not** disconnect sessions
   - The volume at `/app/.sessions` survives redeploys
   - Only a phone-side logout or ban forces a rescan
