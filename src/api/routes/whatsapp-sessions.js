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

/**
 * WAHA Core (free tier) only supports a single session named "default".
 * Always use this constant for all WAHA API calls.
 */
const WAHA_SESSION = "default";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Get the current WAHA session state.
 * Tries GET /api/sessions (list) first, then GET /api/sessions/:name as fallback.
 * Returns status string (STARTING, SCAN_QR_CODE, WORKING, STOPPED, FAILED)
 * or "NOT_FOUND" / null (unreachable).
 */
async function getWahaSessionState(sessionName) {
  // Method 1: List all sessions
  try {
    const res = await axios.get(`${WAHA_BASE}/api/sessions`, {
      headers: WAHA_HEADERS,
      timeout: 10000,
    });
    const data = res.data;
    const sessions = Array.isArray(data) ? data : [];

    // Debug: log what WAHA actually returns (first call only)
    if (!getWahaSessionState._logged) {
      console.log(
        `[waha-debug] GET /api/sessions response (type=${typeof data}, isArray=${Array.isArray(data)}, length=${sessions.length}):`,
        JSON.stringify(data).slice(0, 500),
      );
      getWahaSessionState._logged = true;
    }

    // Try multiple property names — WAHA versions differ
    const found = sessions.find(
      (s) =>
        s.name === sessionName ||
        s.session === sessionName ||
        s.id === sessionName,
    );
    if (found) {
      const status = found.status || found.state || "UNKNOWN";
      return status;
    }
  } catch (err) {
    console.warn(
      `[waha-debug] GET /api/sessions failed: ${err.response?.status || err.message}`,
    );
  }

  // Method 2: Direct session endpoint (works in some WAHA versions)
  try {
    const res = await axios.get(`${WAHA_BASE}/api/sessions/${sessionName}`, {
      headers: WAHA_HEADERS,
      timeout: 10000,
    });
    const status = res.data?.status || res.data?.state || null;
    if (status) {
      console.log(`[waha-debug] GET /api/sessions/${sessionName} → ${status}`);
      return status;
    }
  } catch (err) {
    if (err.response?.status === 404) {
      return "NOT_FOUND";
    }
    // Other errors — WAHA may be unreachable
  }

  return "NOT_FOUND";
}

/**
 * Attempt to fetch QR code from WAHA. Returns string or null.
 */
async function fetchQrCode(sessionName) {
  try {
    const res = await axios.get(`${WAHA_BASE}/api/${sessionName}/auth/qr`, {
      headers: WAHA_HEADERS,
      timeout: 10000,
    });
    return res.data?.value || (typeof res.data === "string" ? res.data : null);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions
//  Create a new WAHA session for an entity.
//  Waits for QR to become available (WEBJS can take 20-30 s).
// ─────────────────────────────────────────────────────────────
router.post("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id, entity_name } = req.body;

    if (!entity_id) {
      return res.status(400).json({ error: "Required: entity_id" });
    }

    const sessionName = WAHA_SESSION;
    const sql = getDb();

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
      });
    }

    // ── Step 1: Ensure WAHA session exists and is running ──
    const webhookUrl = config.waha.webhookSecret
      ? `${config.baseUrl}/whatsapp/sessions/webhook?secret=${config.waha.webhookSecret}`
      : `${config.baseUrl}/whatsapp/sessions/webhook`;

    const currentState = await getWahaSessionState(sessionName);
    console.log(`[whatsapp-sessions] Current WAHA state: ${currentState}`);

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
          { headers: WAHA_HEADERS, timeout: 15000 },
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

    if (
      currentState === "STOPPED" ||
      currentState === "FAILED" ||
      currentState === "WORKING"
    ) {
      // Restart the session to get a fresh QR
      try {
        await axios.post(
          `${WAHA_BASE}/api/sessions/${sessionName}/restart`,
          {},
          { headers: WAHA_HEADERS, timeout: 15000 },
        );
        console.log(`[whatsapp-sessions] Restarted WAHA session`);
      } catch (err) {
        console.warn("[whatsapp-sessions] Restart failed:", err.message);
        // Try stop + start as fallback
        try {
          await axios.post(
            `${WAHA_BASE}/api/sessions/${sessionName}/stop`,
            {},
            { headers: WAHA_HEADERS, timeout: 10000 },
          );
        } catch {
          /* ignore */
        }
        try {
          await axios.post(
            `${WAHA_BASE}/api/sessions`,
            { name: sessionName },
            { headers: WAHA_HEADERS, timeout: 15000 },
          );
          console.log(`[whatsapp-sessions] Recreated session after stop`);
        } catch {
          /* will pick up on polling */
        }
      }
    }

    // If already in SCAN_QR_CODE, skip waiting for state and fetch QR directly

    // ── Step 2: Poll state until SCAN_QR_CODE, then fetch QR (up to 30 s) ──
    let qrCode = null;
    let consecutiveNotFound = 0;

    for (let attempt = 1; attempt <= 15; attempt++) {
      await sleep(2000);

      const state = await getWahaSessionState(sessionName);

      // Also try fetching QR directly — some WAHA versions don't list
      // sessions correctly but still serve the QR endpoint
      const directQr = await fetchQrCode(sessionName);

      console.log(
        `[whatsapp-sessions] Poll ${attempt}/15: state=${state}, qr=${directQr ? `yes(${String(directQr).length}ch)` : "no"}`,
      );

      if (directQr) {
        qrCode = directQr;
        console.log(
          `[whatsapp-sessions] ✅ QR obtained on attempt ${attempt} (${String(qrCode).length} chars)`,
        );
        break;
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
              { headers: WAHA_HEADERS, timeout: 15000 },
            );
            console.log(`[whatsapp-sessions] Re-created session`);
          } catch {
            // Try start endpoint
            try {
              await axios.post(
                `${WAHA_BASE}/api/sessions/${sessionName}/start`,
                {},
                { headers: WAHA_HEADERS, timeout: 15000 },
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

    await sql`
      INSERT INTO whatsapp_sessions (app_id, entity_id, waha_session, status, qr_code)
      VALUES (${appId}, ${entity_id}, ${sessionName}, ${dbStatus}, ${qrCode})
      ON CONFLICT (app_id, entity_id) DO UPDATE SET
        waha_session = EXCLUDED.waha_session,
        status = EXCLUDED.status,
        qr_code = EXCLUDED.qr_code
    `;

    return res.status(201).json({
      success: true,
      session: sessionName,
      qr_code: qrCode,
      status: dbStatus,
      entity_name: entity_name || entity_id,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /whatsapp/sessions/:entity_id
//  Check connection status. Frontend polls this every 5 s.
//  LIGHTWEIGHT — no restarts, no retries. Just fetch QR once.
// ─────────────────────────────────────────────────────────────
router.get("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT waha_session, status, phone_number, connected_at, disconnected_at, qr_code, created_at
      FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.json({ success: true, status: "not_configured" });
    }

    const session = rows[0];
    const result = {
      success: true,
      waha_session: session.waha_session,
      status: session.status,
      phone_number: session.phone_number,
      connected_at: session.connected_at,
      disconnected_at: session.disconnected_at,
      created_at: session.created_at,
      qr_code: session.qr_code || null,
    };

    // If still pending, try to get fresh data from WAHA (single attempt, fast)
    if (session.status === "pending") {
      const wahaState = await getWahaSessionState(session.waha_session);

      // Always try to get QR directly regardless of state
      const freshQr = await fetchQrCode(session.waha_session);

      if (wahaState === "SCAN_QR_CODE" || freshQr) {
        if (freshQr) {
          result.qr_code = freshQr;
          await sql`
            UPDATE whatsapp_sessions SET qr_code = ${freshQr}
            WHERE app_id = ${appId} AND entity_id = ${entity_id}
          `.catch(() => {});
        }
      } else if (wahaState === "WORKING") {
        // Session got authenticated (via webhook or otherwise)
        result.status = "active";
        await sql`
          UPDATE whatsapp_sessions SET status = 'active', connected_at = now()
          WHERE app_id = ${appId} AND entity_id = ${entity_id}
        `.catch(() => {});
      } else if (wahaState === "FAILED" || wahaState === "STOPPED") {
        result.status = "disconnected";
        result.waha_state = wahaState;
        await sql`
          UPDATE whatsapp_sessions SET status = 'disconnected', disconnected_at = now()
          WHERE app_id = ${appId} AND entity_id = ${entity_id}
        `.catch(() => {});
      }
      // STARTING / NOT_FOUND / null — return cached data, no restart
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
// ─────────────────────────────────────────────────────────────
router.delete("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT waha_session FROM whatsapp_sessions
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sessionName = rows[0].waha_session;

    // Logout from WhatsApp
    try {
      await axios.post(
        `${WAHA_BASE}/api/sessions/${sessionName}/logout`,
        {},
        { headers: WAHA_HEADERS, timeout: 10000 },
      );
    } catch (err) {
      console.warn("[whatsapp-sessions] Logout warning:", err.message);
    }

    // Stop the WAHA session
    try {
      await axios.delete(`${WAHA_BASE}/api/sessions/${sessionName}`, {
        headers: WAHA_HEADERS,
        timeout: 10000,
      });
    } catch (err) {
      console.warn("[whatsapp-sessions] Delete session warning:", err.message);
    }

    // Update DB
    await sql`
      UPDATE whatsapp_sessions
      SET status = 'disconnected', disconnected_at = now()
      WHERE app_id = ${appId} AND entity_id = ${entity_id}
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("[whatsapp-sessions] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions/webhook
//  WAHA calls this when a session status changes.
//  NO API KEY AUTH — verified via optional webhook secret.
// ─────────────────────────────────────────────────────────────
router.post("/sessions/webhook", async (req, res) => {
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
          { headers: WAHA_HEADERS, timeout: 10000 },
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
});

module.exports = router;
