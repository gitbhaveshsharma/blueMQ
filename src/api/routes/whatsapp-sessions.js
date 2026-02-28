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
 * Sanitise a string into a valid WAHA session name.
 * Rules: lowercase, no spaces, no special chars, max 50 chars.
 */
function sanitiseSessionName(appId, entityId) {
  const raw = `${appId}-${entityId}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);
}

// ─────────────────────────────────────────────────────────────
//  POST /whatsapp/sessions
//  Create a new WAHA session for an entity (coaching center).
//  Returns a QR code for the coach to scan.
// ─────────────────────────────────────────────────────────────
router.post("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id, entity_name } = req.body;

    if (!entity_id) {
      return res.status(400).json({ error: "Required: entity_id" });
    }

    const sessionName = sanitiseSessionName(appId, entity_id);
    const sql = getDb();

    // Check if session already exists
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

    // Create (or restart) session in WAHA
    const webhookUrl = config.waha.webhookSecret
      ? `${config.baseUrl}/whatsapp/sessions/webhook?secret=${config.waha.webhookSecret}`
      : `${config.baseUrl}/whatsapp/sessions/webhook`;

    try {
      await axios.post(
        `${WAHA_BASE}/api/sessions`,
        {
          name: sessionName,
          config: {
            webhooks: [
              {
                url: webhookUrl,
                events: ["session.status"],
              },
            ],
          },
        },
        { headers: WAHA_HEADERS, timeout: 15000 },
      );
    } catch (err) {
      // 422 = session already exists in WAHA — that's fine, we'll re-fetch QR
      if (err.response?.status !== 422) {
        console.error(
          "[whatsapp-sessions] WAHA create session error:",
          err.response?.data || err.message,
        );
        return res.status(502).json({ error: "Failed to create WAHA session" });
      }
    }

    // Fetch QR code
    let qrCode = null;
    try {
      const qrRes = await axios.get(`${WAHA_BASE}/api/${sessionName}/auth/qr`, {
        headers: WAHA_HEADERS,
        timeout: 15000,
      });
      qrCode = qrRes.data?.value || qrRes.data || null;
    } catch (err) {
      console.warn(
        "[whatsapp-sessions] Could not fetch QR (session may already be authenticated):",
        err.message,
      );
    }

    // Upsert into whatsapp_sessions
    await sql`
      INSERT INTO whatsapp_sessions (app_id, entity_id, waha_session, status, qr_code)
      VALUES (${appId}, ${entity_id}, ${sessionName}, 'pending', ${qrCode})
      ON CONFLICT (app_id, entity_id) DO UPDATE SET
        waha_session = EXCLUDED.waha_session,
        status = CASE
          WHEN whatsapp_sessions.status = 'active' THEN whatsapp_sessions.status
          ELSE 'pending'
        END,
        qr_code = EXCLUDED.qr_code
    `;

    return res.status(201).json({
      success: true,
      session: sessionName,
      qr_code: qrCode,
      status: "pending",
      entity_name: entity_name || entity_id,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /whatsapp/sessions/:entity_id
//  Check connection status. Frontend polls this after QR shown.
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
    };

    // If still pending, fetch a fresh QR from WAHA
    if (session.status === "pending") {
      try {
        const qrRes = await axios.get(
          `${WAHA_BASE}/api/${session.waha_session}/auth/qr`,
          { headers: WAHA_HEADERS, timeout: 10000 },
        );
        result.qr_code = qrRes.data?.value || qrRes.data || session.qr_code;
      } catch {
        result.qr_code = session.qr_code;
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
