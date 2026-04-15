const { Router } = require("express");
const axios = require("axios");
const { getDb } = require("../../db");
const config = require("../../config");

const router = Router();

const WAHA_BASE = config.waha.baseUrl;
const WAHA_HEADERS = {
  "Content-Type": "application/json",
  ...(config.waha.apiKey ? { "X-Api-Key": config.waha.apiKey } : {}),
};

const WAHA_STATE_TIMEOUT_MS = config.waha.stateTimeoutMs;
const WAHA_QR_TIMEOUT_MS = config.waha.qrTimeoutMs;
const WAHA_WRITE_TIMEOUT_MS = config.waha.writeTimeoutMs;
const WAHA_POLL_ATTEMPTS = config.waha.pollAttempts;
const WAHA_POLL_DELAY_MS = config.waha.pollDelayMs;
const WAHA_RECONCILE_COOLDOWN_MS = config.waha.reconcileCooldownMs;

const wahaErrorLogTs = new Map();
const lastReconcileTs = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isWahaConnectivityError(err) {
  return (
    err?.code === "ECONNREFUSED" ||
    err?.code === "ENOTFOUND" ||
    err?.code === "ETIMEDOUT" ||
    err?.code === "ECONNABORTED"
  );
}

function logWahaWarn(key, message, throttleMs = 30000) {
  const now = Date.now();
  const lastTs = wahaErrorLogTs.get(key) || 0;
  if (now - lastTs >= throttleMs) {
    console.warn(message);
    wahaErrorLogTs.set(key, now);
  }
}

function shouldReconcileNow(sessionName) {
  const now = Date.now();
  const lastTs = lastReconcileTs.get(sessionName) || 0;
  if (now - lastTs < WAHA_RECONCILE_COOLDOWN_MS) {
    return false;
  }
  lastReconcileTs.set(sessionName, now);
  return true;
}

/**
 * The default WAHA session name.
 * WAHA Core (free tier) only supports a single session with this name.
 * The FIRST session created for each app always uses "default" so it works
 * out-of-the-box with WAHA Core.  Additional sessions require WAHA Plus.
 */
const DEFAULT_SESSION = "default";

/**
 * WAHA tier thresholds.
 *   - Core  (free): 1 session only (named "default")
 *   - Plus  (paid): up to 100 concurrent sessions
 *   - Pro   (paid): 100+ concurrent sessions
 */
const TIER_THRESHOLDS = { plus: 1, pro: 100 };

/**
 * Build a deterministic, URL-safe WAHA session name from appId + entityId.
 *
 * Examples:
 *   buildSessionName("tutrsy", "coach_1")          → "tutrsy-coach-1"
 *   buildSessionName("tutrsy", "coaching center 2") → "tutrsy-coaching-center-2"
 *
 * Rules:
 *   - Lowercase, alphanumeric + hyphens only (WAHA session name constraints)
 *   - Max 64 chars (safe for WAHA + logging)
 *   - Deterministic: same inputs always produce the same name
 */
function buildSessionName(appId, entityId) {
  const raw = `${appId}-${entityId}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // replace non-alphanumeric with hyphens
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .slice(0, 64);
}

/**
 * Resolve the WAHA session name to use for a given entity.
 *   - First session per app → "default" (WAHA Core compatible)
 *   - Additional sessions   → buildSessionName(appId, entityId)
 *
 * Also returns a `tier` hint so callers can surface upgrade warnings.
 */
async function resolveSessionName(sql, appId, entityId) {
  // Count existing sessions for this app (excluding the entity being created/re-created)
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count
    FROM whatsapp_sessions
    WHERE app_id = ${appId} AND entity_id != ${entityId}
  `;

  // Check if this entity already has a row (re-create / reconnect)
  const [existingRow] = await sql`
    SELECT waha_session FROM whatsapp_sessions
    WHERE app_id = ${appId} AND entity_id = ${entityId}
    LIMIT 1
  `;

  // If the entity already has a session name, keep it (don't rename mid-lifecycle).
  if (existingRow) {
    return {
      sessionName: existingRow.waha_session,
      totalSessions: count + 1,
      tier:
        count + 1 > TIER_THRESHOLDS.pro
          ? "pro"
          : count + 1 > TIER_THRESHOLDS.plus
            ? "plus"
            : "core",
    };
  }

  // First session ever → "default" (works on free WAHA Core).
  if (count === 0) {
    return { sessionName: DEFAULT_SESSION, totalSessions: 1, tier: "core" };
  }

  // Additional sessions → unique name (requires WAHA Plus / Pro).
  const sessionName = buildSessionName(appId, entityId);
  const total = count + 1;
  const tier = total > TIER_THRESHOLDS.pro ? "pro" : "plus";
  return { sessionName, totalSessions: total, tier };
}

/**
 * Strip null bytes (0x00) and other characters PostgreSQL UTF-8 rejects.
 * WAHA embeds \x00 padding in its QR strings which causes NeonDbError 22021.
 */
function sanitizeQr(qr) {
  if (!qr) return qr;
  // eslint-disable-next-line no-control-regex
  return qr.replace(/\x00/g, "");
}

/**
 * Get the current WAHA session state.
 * Tries GET /api/sessions/:name first, then GET /api/sessions as fallback.
 * Returns status string (STARTING, SCAN_QR_CODE, WORKING, STOPPED, FAILED)
 * or "NOT_FOUND" / "UNREACHABLE".
 */
async function getWahaSessionState(sessionName) {
  let connectivityError = false;

  // Method 1 (preferred): direct session endpoint
  try {
    const res = await axios.get(`${WAHA_BASE}/api/sessions/${sessionName}`, {
      headers: WAHA_HEADERS,
      timeout: WAHA_STATE_TIMEOUT_MS,
    });
    const status =
      res.data?.status || res.data?.state || res.data?.session?.status || null;
    if (status) return status;
  } catch (err) {
    if (err.response?.status === 404) {
      return "NOT_FOUND";
    }
    if (isWahaConnectivityError(err)) {
      connectivityError = true;
      logWahaWarn(
        "state-direct-connectivity",
        `[waha-debug] GET /api/sessions/${sessionName} failed: ${err.message}`,
      );
    }
  }

  // Method 2 (fallback): list sessions (older WAHA variants)
  try {
    const res = await axios.get(`${WAHA_BASE}/api/sessions`, {
      headers: WAHA_HEADERS,
      timeout: WAHA_STATE_TIMEOUT_MS,
    });
    const data = res.data;
    const sessions = Array.isArray(data)
      ? data
      : Array.isArray(data?.sessions)
        ? data.sessions
        : [];
    const found = sessions.find(
      (s) =>
        s.name === sessionName ||
        s.session === sessionName ||
        s.id === sessionName,
    );
    if (!found) {
      return "NOT_FOUND";
    }
    return found.status || found.state || "UNKNOWN";
  } catch (err) {
    if (err.response?.status === 404) {
      return "NOT_FOUND";
    }
    if (isWahaConnectivityError(err)) {
      connectivityError = true;
      logWahaWarn(
        "state-list-connectivity",
        `[waha-debug] GET /api/sessions failed: ${err.message}`,
      );
    }
  }

  return connectivityError ? "UNREACHABLE" : "NOT_FOUND";
}

/**
 * Attempt to fetch QR code from WAHA. Returns string or null.
 */
async function fetchQrCode(sessionName) {
  try {
    // Use arraybuffer so Node.js never decodes binary PNG bytes as UTF-8.
    // If we let axios decode as a string, binary bytes get mangled into
    // U+FFFD replacement characters, producing an invalid data URI.
    const res = await axios.get(`${WAHA_BASE}/api/${sessionName}/auth/qr`, {
      headers: WAHA_HEADERS,
      timeout: WAHA_QR_TIMEOUT_MS,
      responseType: "arraybuffer",
    });

    const contentType = (res.headers["content-type"] || "").toLowerCase();

    if (contentType.includes("application/json")) {
      // WAHA returned JSON — parse and extract the value field
      const raw = Buffer.from(res.data).toString("utf8");
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        return null;
      }
      const val = json?.value || null;
      if (!val) return null;
      // Already a data URI (some WAHA versions) — return as-is
      if (val.startsWith("data:")) return val;
      // Raw QR text payload — too long for QRCodeSVG, so we can't use it
      // as a data URI here; return null and let the poll retry
      return null;
    }

    // Binary image (PNG / SVG / JPEG) — safe base64 encode from the raw buffer
    const mime = contentType.startsWith("image/")
      ? contentType.split(";")[0].trim()
      : "image/png";
    const base64 = Buffer.from(res.data).toString("base64");
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    if (isWahaConnectivityError(err)) {
      logWahaWarn(
        "qr-connectivity",
        `[waha-debug] GET /api/${sessionName}/auth/qr failed: ${err.message}`,
      );
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions
//  Create a new WhatsApp session for an entity.
//  Supports two connection types:
//    - 'waha' (default): Creates WAHA session, waits for QR
//    - 'meta': Saves Meta API credentials, marks active immediately
// ─────────────────────────────────────────────────────────────
router.post("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const {
      entity_id,
      entity_name,
      connection_type = "waha",
      meta_api_key,
      meta_phone_number_id,
      meta_business_account_id,
    } = req.body;

    if (!entity_id) {
      return res.status(400).json({ error: "Required: entity_id" });
    }

    // Validate connection_type
    if (!["waha", "meta"].includes(connection_type)) {
      return res.status(400).json({
        error: "Invalid connection_type. Must be 'waha' or 'meta'",
      });
    }

    const sql = getDb();

    // ─── Meta WhatsApp Cloud API Connection ───
    if (connection_type === "meta") {
      // Validate Meta-specific fields
      if (!meta_api_key) {
        return res.status(400).json({
          error: "Required for Meta connection: meta_api_key",
        });
      }
      if (!meta_phone_number_id) {
        return res.status(400).json({
          error: "Required for Meta connection: meta_phone_number_id",
        });
      }

      // Check if session already exists
      const existing = await sql`
        SELECT id, status, connection_type
        FROM whatsapp_sessions
        WHERE app_id = ${appId} AND entity_id = ${entity_id}
        LIMIT 1
      `;

      if (existing.length > 0 && existing[0].status === "active") {
        return res.json({
          success: true,
          connection_type: existing[0].connection_type,
          status: "active",
          message: "WhatsApp session is already active",
        });
      }

      // Generate a placeholder session name for Meta (not used but required by schema)
      const metaSessionName = `meta-${appId}-${entity_id}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 64);

      // Upsert Meta session — active immediately (no QR scan needed)
      await sql`
        INSERT INTO whatsapp_sessions (
          app_id, entity_id, waha_session, status, connection_type,
          meta_api_key, meta_phone_number_id, meta_business_account_id,
          connected_at
        )
        VALUES (
          ${appId}, ${entity_id}, ${metaSessionName}, 'active', 'meta',
          ${meta_api_key}, ${meta_phone_number_id}, ${meta_business_account_id || null},
          now()
        )
        ON CONFLICT (app_id, entity_id) DO UPDATE SET
          waha_session = EXCLUDED.waha_session,
          status = 'active',
          connection_type = 'meta',
          meta_api_key = EXCLUDED.meta_api_key,
          meta_phone_number_id = EXCLUDED.meta_phone_number_id,
          meta_business_account_id = EXCLUDED.meta_business_account_id,
          connected_at = now(),
          disconnected_at = NULL
      `;

      console.log(
        `[whatsapp-sessions] ✅ Meta session created for entity ${entity_id}`,
      );

      return res.status(201).json({
        success: true,
        connection_type: "meta",
        status: "active",
        entity_id,
        entity_name: entity_name || entity_id,
        message: "Meta WhatsApp API configured successfully",
      });
    }

    // ─── WAHA Connection (existing flow) ───
    const { sessionName, totalSessions, tier } = await resolveSessionName(
      sql,
      appId,
      entity_id,
    );

    // Build tier warning (if applicable)
    const tierWarning =
      tier === "pro"
        ? `You have ${totalSessions} sessions. 100+ concurrent sessions require WAHA Pro.`
        : tier === "plus"
          ? `You have ${totalSessions} sessions. Multiple sessions require WAHA Plus (paid). WAHA Core only supports 1 session.`
          : null;

    // Check if session already exists in our DB
    const existing = await sql`
      SELECT waha_session, status, phone_number, connected_at, qr_code
      FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (existing.length > 0 && existing[0].status === "active") {
      return res.json({
        success: true,
        session: existing[0].waha_session,
        status: "active",
        phone_number: existing[0].phone_number,
        connected_at: existing[0].connected_at,
        message: "WhatsApp is already connected",
        tier,
        tier_warning: tierWarning,
      });
    }

    // ── Step 1: Ensure WAHA session exists and is running ──
    const webhookUrl = config.waha.webhookSecret
      ? `${config.baseUrl}/whatsapp/sessions/webhook?secret=${config.waha.webhookSecret}`
      : `${config.baseUrl}/whatsapp/sessions/webhook`;

    const currentState = await getWahaSessionState(sessionName);
    console.log(`[whatsapp-sessions] Current WAHA state: ${currentState}`);

    if (currentState === "UNREACHABLE") {
      return res.status(503).json({
        error:
          "WAHA is temporarily unreachable. Please check WAHA service health and retry.",
      });
    }

    if (currentState === "NOT_FOUND" || !currentState) {
      // Session doesn't exist — create it
      try {
        const createRes = await axios.post(
          `${WAHA_BASE}/api/sessions`,
          {
            name: sessionName,
            config: {
              webhooks: [{ url: webhookUrl, events: ["session.status"] }],
            },
          },
          { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
        );
        console.log(
          `[whatsapp-sessions] Created WAHA session '${sessionName}' — response:`,
          JSON.stringify(createRes.data).slice(0, 500),
        );
      } catch (err) {
        if (err.response?.status !== 422) {
          console.error(
            "[whatsapp-sessions] Create error:",
            err.response?.data || err.message,
          );
          return res
            .status(502)
            .json({ error: "Failed to create WAHA session" });
        }
        // 422 = somehow already exists — fall through to restart
        console.log(
          `[whatsapp-sessions] Session already exists (422), will restart`,
        );
      }
    }

    if (currentState === "STOPPED" || currentState === "FAILED") {
      // Restart the session to get a fresh QR
      try {
        await axios.post(
          `${WAHA_BASE}/api/sessions/${sessionName}/restart`,
          {},
          { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
        );
        console.log(`[whatsapp-sessions] Restarted WAHA session`);
      } catch (err) {
        console.warn("[whatsapp-sessions] Restart failed:", err.message);
        // Try stop + start as fallback
        try {
          await axios.post(
            `${WAHA_BASE}/api/sessions/${sessionName}/stop`,
            {},
            { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
          );
        } catch {
          /* ignore */
        }
        try {
          await axios.post(
            `${WAHA_BASE}/api/sessions`,
            { name: sessionName },
            { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
          );
          console.log(`[whatsapp-sessions] Recreated session after stop`);
        } catch {
          /* will pick up on polling */
        }
      }
    }

    // If already in SCAN_QR_CODE, skip waiting for state and fetch QR directly

    // ── Step 2: Poll state until SCAN_QR_CODE, then fetch QR ──
    let qrCode = null;
    let consecutiveNotFound = 0;

    for (let attempt = 1; attempt <= WAHA_POLL_ATTEMPTS; attempt++) {
      await sleep(WAHA_POLL_DELAY_MS);

      // Query WAHA state + QR in parallel to keep each attempt bounded.
      const [state, directQr] = await Promise.all([
        getWahaSessionState(sessionName),
        fetchQrCode(sessionName),
      ]);

      console.log(
        `[whatsapp-sessions] Poll ${attempt}/${WAHA_POLL_ATTEMPTS}: state=${state}, qr=${directQr ? `yes(${String(directQr).length}ch)` : "no"}`,
      );

      if (directQr) {
        qrCode = directQr;
        console.log(
          `[whatsapp-sessions] ✅ QR obtained on attempt ${attempt} (${String(qrCode).length} chars)`,
        );
        break;
      }

      if (state === "UNREACHABLE") {
        continue;
      }

      if (state === "NOT_FOUND") {
        consecutiveNotFound++;
        // If session vanished after 5 consecutive NOT_FOUND, try recreating
        if (consecutiveNotFound === 5) {
          console.warn(
            `[whatsapp-sessions] Session stuck as NOT_FOUND, retrying create…`,
          );
          try {
            await axios.post(
              `${WAHA_BASE}/api/sessions`,
              { name: sessionName, start: true },
              { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
            );
            console.log(`[whatsapp-sessions] Re-created session`);
          } catch {
            // Try start endpoint
            try {
              await axios.post(
                `${WAHA_BASE}/api/sessions/${sessionName}/start`,
                {},
                { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
              );
              console.log(`[whatsapp-sessions] Started session explicitly`);
            } catch {
              /* keep polling */
            }
          }
        }
      } else {
        consecutiveNotFound = 0;
      }

      if (state === "SCAN_QR_CODE") {
        // State correct but QR fetch failed — retry
        continue;
      } else if (state === "WORKING") {
        console.log(`[whatsapp-sessions] Session already authenticated`);
        break;
      } else if (state === "FAILED") {
        console.error(`[whatsapp-sessions] Session FAILED, giving up`);
        break;
      }
      // STARTING / NOT_FOUND / null — keep waiting
    }

    // ── Step 3: Upsert into our DB ──
    const finalState = await getWahaSessionState(sessionName);
    const dbStatus =
      finalState === "WORKING"
        ? "active"
        : finalState === "FAILED" || finalState === "STOPPED"
          ? "disconnected"
          : "pending";

    const safeQrCode = sanitizeQr(qrCode);
    await sql`
      INSERT INTO whatsapp_sessions (app_id, entity_id, waha_session, status, qr_code)
      VALUES (${appId}, ${entity_id}, ${sessionName}, ${dbStatus}, ${safeQrCode})
      ON CONFLICT (app_id, entity_id) DO UPDATE SET
        waha_session = EXCLUDED.waha_session,
        status = EXCLUDED.status,
        qr_code = EXCLUDED.qr_code
    `;

    return res.status(201).json({
      success: true,
      session: sessionName,
      qr_code: safeQrCode,
      status: dbStatus,
      entity_name: entity_name || entity_id,
      tier,
      tier_warning: tierWarning,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /whatsapp/sessions
//  List ALL WhatsApp sessions for the authenticated app.
//  Optional query params: ?status=active
// ─────────────────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const { status } = req.query;
    const sql = getDb();

    let rows;
    if (status) {
      rows = await sql`
        SELECT entity_id, waha_session, status, phone_number, connection_type,
               connected_at, disconnected_at, created_at
        FROM whatsapp_sessions
        WHERE app_id = ${appId} AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT entity_id, waha_session, status, phone_number, connection_type,
               connected_at, disconnected_at, created_at
        FROM whatsapp_sessions
        WHERE app_id = ${appId}
        ORDER BY created_at DESC
      `;
    }

    // Determine WAHA tier based on session count
    const total = rows.length;
    const tier =
      total > TIER_THRESHOLDS.pro
        ? "pro"
        : total > TIER_THRESHOLDS.plus
          ? "plus"
          : "core";
    const tierWarning =
      tier === "pro"
        ? `You have ${total} sessions. 100+ concurrent sessions require WAHA Pro.`
        : tier === "plus"
          ? `You have ${total} sessions. Multiple sessions require WAHA Plus (paid). WAHA Core only supports 1 session.`
          : null;

    return res.json({
      success: true,
      count: total,
      sessions: rows,
      tier,
      tier_warning: tierWarning,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] GET /sessions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /whatsapp/sessions/:entity_id
//  Check connection status. Frontend polls this every 5 s.
//  LIGHTWEIGHT — no restarts, no retries. Just fetch QR once.
//  For Meta sessions, returns masked API key (last 6 chars only).
// ─────────────────────────────────────────────────────────────
router.get("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT entity_id, waha_session, status, phone_number, connected_at, 
             disconnected_at, qr_code, created_at, connection_type,
             meta_api_key, meta_phone_number_id, meta_business_account_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.json({ success: true, status: "not_configured" });
    }

    const session = rows[0];
    const connectionType = session.connection_type || "waha";

    // Helper to mask API key (show only last 6 chars)
    const maskApiKey = (key) => {
      if (!key) return null;
      if (key.length <= 6) return "...***";
      return "..." + key.slice(-6);
    };

    const result = {
      success: true,
      entity_id: session.entity_id,
      waha_session: session.waha_session,
      status: session.status,
      phone_number: session.phone_number,
      connected_at: session.connected_at,
      disconnected_at: session.disconnected_at,
      created_at: session.created_at,
      connection_type: connectionType,
      qr_code: session.qr_code || null,
    };

    // Add Meta-specific fields if connection_type is 'meta'
    if (connectionType === "meta") {
      result.meta_api_key = maskApiKey(session.meta_api_key);
      result.meta_phone_number_id = session.meta_phone_number_id;
      result.meta_business_account_id =
        session.meta_business_account_id || null;
      // Meta sessions don't need WAHA reconciliation
      return res.json(result);
    }

    // ── Live WAHA reconciliation (only for WAHA connections) ─────────────────
    // Always verify against WAHA when pending OR active-but-no-phone-number.
    // This means the frontend sees the right state even when webhooks fail.
    const needsReconcile =
      session.status === "pending" ||
      (session.status === "active" && !session.phone_number);

    if (needsReconcile && shouldReconcileNow(session.waha_session)) {
      const wahaState = await getWahaSessionState(session.waha_session);

      if (wahaState === "UNREACHABLE") {
        result.waha_state = "UNREACHABLE";
      }

      if (wahaState === "WORKING") {
        // ── Authenticated — mark active + fetch phone number ──
        result.status = "active";
        if (!result.connected_at)
          result.connected_at = new Date().toISOString();

        // Try to get the phone number from WAHA
        let phoneNumber = null;
        try {
          const info = await axios.get(
            `${WAHA_BASE}/api/sessions/${session.waha_session}`,
            { headers: WAHA_HEADERS, timeout: WAHA_STATE_TIMEOUT_MS },
          );
          phoneNumber = info.data?.me?.id?.replace("@c.us", "") || null;
        } catch {
          // non-fatal — phone number will be populated on next poll
        }

        result.phone_number = phoneNumber;
        await sql`
          UPDATE whatsapp_sessions
          SET status = 'active',
              connected_at = COALESCE(connected_at, now()),
              phone_number = COALESCE(phone_number, ${phoneNumber})
          WHERE app_id = ${appId} AND entity_id = ${entity_id}
        `.catch(() => {});
      } else if (session.status === "pending") {
        // Only do QR / state updates when we are in pending state
        if (wahaState === "SCAN_QR_CODE") {
          const freshQr = await fetchQrCode(session.waha_session);
          if (freshQr) {
            result.qr_code = freshQr;
            await sql`
              UPDATE whatsapp_sessions SET qr_code = ${freshQr}
              WHERE app_id = ${appId} AND entity_id = ${entity_id}
            `.catch(() => {});
          }
        } else if (wahaState === "FAILED" || wahaState === "STOPPED") {
          result.status = "disconnected";
          result.waha_state = wahaState;
          await sql`
            UPDATE whatsapp_sessions SET status = 'disconnected', disconnected_at = now()
            WHERE app_id = ${appId} AND entity_id = ${entity_id}
          `.catch(() => {});
        } else if (wahaState !== "UNREACHABLE") {
          // STARTING — try fetching QR optimistically
          const freshQr = await fetchQrCode(session.waha_session);
          if (freshQr) {
            result.qr_code = freshQr;
            await sql`
              UPDATE whatsapp_sessions SET qr_code = ${freshQr}
              WHERE app_id = ${appId} AND entity_id = ${entity_id}
            `.catch(() => {});
          }
        }
      }
    }

    return res.json(result);
  } catch (err) {
    console.error("[whatsapp-sessions] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /whatsapp/sessions/:entity_id
//  Coach disconnects their WhatsApp.
//  For WAHA: logs out and stops the WAHA session.
//  For Meta: just marks as disconnected (no API call needed).
// ─────────────────────────────────────────────────────────────
router.delete("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT waha_session, connection_type FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { waha_session: sessionName, connection_type: connectionType } =
      rows[0];

    // Only call WAHA API for WAHA connections
    if (connectionType !== "meta") {
      // Logout from WhatsApp
      try {
        await axios.post(
          `${WAHA_BASE}/api/sessions/${sessionName}/logout`,
          {},
          { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
        );
      } catch (err) {
        console.warn("[whatsapp-sessions] Logout warning:", err.message);
      }

      // Stop the WAHA session
      try {
        await axios.delete(`${WAHA_BASE}/api/sessions/${sessionName}`, {
          headers: WAHA_HEADERS,
          timeout: WAHA_WRITE_TIMEOUT_MS,
        });
      } catch (err) {
        console.warn(
          "[whatsapp-sessions] Delete session warning:",
          err.message,
        );
      }
    }

    // Update DB — clear Meta credentials for security
    await sql`
      UPDATE whatsapp_sessions
      SET status = 'disconnected',
          disconnected_at = now(),
          meta_api_key = NULL
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
    `;

    console.log(
      `[whatsapp-sessions] Session ${entity_id} disconnected (type: ${connectionType || "waha"})`,
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[whatsapp-sessions] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions/:entity_id/test-message
//  Send a test WhatsApp message to verify the connection works.
//  Body: { phone: "919876543210", message?: "..." }
//  phone must be digits only (no +, no spaces) — WhatsApp intl format
//  Supports both WAHA and Meta WhatsApp providers.
// ─────────────────────────────────────────────────────────────
router.post("/sessions/:entity_id/test-message", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const { phone, message } = req.body;

    if (!phone || !/^\d{7,15}$/.test(phone.trim())) {
      return res.status(400).json({
        error:
          "Required: phone — digits only, international format without + (e.g. 919876543210)",
      });
    }

    const sql = getDb();

    // Confirm this entity has an active session
    const rows = await sql`
      SELECT waha_session, status, connection_type, meta_api_key, meta_phone_number_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session = rows[0];

    if (session.status !== "active") {
      const connectionHint =
        session.connection_type === "meta"
          ? "configure Meta API credentials"
          : "scan QR first";
      return res
        .status(409)
        .json({ error: `Session is not active — ${connectionHint}` });
    }

    const cleanPhone = phone.trim();
    const text =
      message?.trim() ||
      "👋 Hello! This is a test message from BlueMQ. Your WhatsApp integration is working correctly.";

    // Route to appropriate provider
    if (session.connection_type === "meta") {
      // ─── Meta WhatsApp Cloud API ───
      const { getWhatsAppProvider } = require("../../providers/bootstrap");
      const metaProvider = getWhatsAppProvider("meta");

      const result = await metaProvider.sendWhatsApp({
        metaApiKey: session.meta_api_key,
        metaPhoneNumberId: session.meta_phone_number_id,
        user: { phone: cleanPhone },
        body: text,
      });

      if (!result.success) {
        console.error(
          "[whatsapp-sessions] Meta test message error:",
          result.error,
        );
        return res
          .status(502)
          .json({ error: `Failed to send message: ${result.error}` });
      }

      console.log(
        `[whatsapp-sessions] ✅ Test message sent to ${cleanPhone} via Meta API`,
      );

      return res.json({
        success: true,
        sent_to: cleanPhone,
        provider: "meta-whatsapp",
        message_id: result.providerMessageId,
      });
    } else {
      // ─── WAHA ───
      const sessionName = session.waha_session;
      const chatId = `${cleanPhone}@c.us`;

      await axios.post(
        `${WAHA_BASE}/api/sendText`,
        { chatId, text, session: sessionName },
        { headers: WAHA_HEADERS, timeout: WAHA_WRITE_TIMEOUT_MS },
      );

      console.log(
        `[whatsapp-sessions] ✅ Test message sent to ${chatId} via WAHA session ${sessionName}`,
      );

      return res.json({
        success: true,
        sent_to: chatId,
        provider: "waha",
      });
    }
  } catch (err) {
    const errorMsg =
      err.response?.data?.message || err.response?.data?.error || err.message;
    console.error("[whatsapp-sessions] Test message error:", errorMsg);
    return res
      .status(502)
      .json({ error: `Failed to send message: ${errorMsg}` });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions/webhook
//  WAHA calls this when a session status changes.
//  NO API KEY AUTH — verified via optional webhook secret.
//  Exported as handleWebhook and registered publicly in index.js
//  (before authMiddleware) so WAHA's requests are not rejected.
// ─────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  try {
    // Optional webhook secret verification
    if (config.waha.webhookSecret) {
      const secret = req.query.secret;
      if (secret !== config.waha.webhookSecret) {
        return res.status(403).json({ error: "Invalid webhook secret" });
      }
    }

    const { session: sessionName, event, payload } = req.body;

    if (!sessionName || !event) {
      return res.status(400).json({ error: "Missing session or event" });
    }

    // Only handle session.status events
    if (event !== "session.status") {
      return res.json({ success: true, ignored: true });
    }

    const wahaStatus = payload?.status;
    if (!wahaStatus) {
      return res.status(400).json({ error: "Missing payload.status" });
    }

    // Map WAHA status to our internal status
    const statusMap = {
      WORKING: "active",
      STARTING: "pending",
      SCAN_QR_CODE: "pending",
      FAILED: "disconnected",
      STOPPED: "disconnected",
    };

    const mappedStatus = statusMap[wahaStatus];
    if (!mappedStatus) {
      console.warn(
        `[whatsapp-webhook] Unknown WAHA status: ${wahaStatus} for session ${sessionName}`,
      );
      return res.json({ success: true, ignored: true });
    }

    const sql = getDb();

    if (mappedStatus === "active") {
      // Session connected — update status + connected_at
      await sql`
        UPDATE whatsapp_sessions
        SET status = 'active', connected_at = now(), disconnected_at = NULL
        WHERE waha_session = ${sessionName}
      `;

      // Try to fetch the phone number from WAHA session info
      try {
        const info = await axios.get(
          `${WAHA_BASE}/api/sessions/${sessionName}`,
          { headers: WAHA_HEADERS, timeout: WAHA_STATE_TIMEOUT_MS },
        );
        const phoneNumber = info.data?.me?.id?.replace("@c.us", "") || null;
        if (phoneNumber) {
          await sql`
            UPDATE whatsapp_sessions
            SET phone_number = ${phoneNumber}
            WHERE waha_session = ${sessionName}
          `;
        }
      } catch (err) {
        console.warn(
          "[whatsapp-webhook] Could not fetch phone number:",
          err.message,
        );
      }

      console.log(`[whatsapp-webhook] ✅ Session ${sessionName} is now ACTIVE`);
    } else if (mappedStatus === "disconnected") {
      await sql`
        UPDATE whatsapp_sessions
        SET status = 'disconnected', disconnected_at = now()
        WHERE waha_session = ${sessionName}
      `;

      console.warn(
        `[whatsapp-webhook] ⚠️ Session ${sessionName} disconnected (${wahaStatus})`,
      );
    } else {
      // pending / scan_qr_code
      await sql`
        UPDATE whatsapp_sessions
        SET status = ${mappedStatus}
        WHERE waha_session = ${sessionName}
      `;

      console.log(
        `[whatsapp-webhook] Session ${sessionName} status: ${mappedStatus}`,
      );
    }

    return res.json({ success: true, status: mappedStatus });
  } catch (err) {
    console.error("[whatsapp-webhook] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Keep the route on the protected router too (belt-and-suspenders;
// in practice the public registration in index.js handles it first).
router.post("/sessions/webhook", handleWebhook);

module.exports = router;
module.exports.handleWebhook = handleWebhook;
