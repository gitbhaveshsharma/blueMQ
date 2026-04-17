const { Router } = require("express");
const { getDb } = require("../../db");
const { getWhatsAppProvider } = require("../../providers/bootstrap");
const {
  normalizeEntityId,
  resolveWhatsAppSession,
} = require("../../utils/whatsapp-session");

const router = Router();

function buildSessionName(appId, entityId) {
  return `meta-${appId}-${entityId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function maskApiKey(key) {
  if (!key) return null;
  if (key.length <= 6) return "...***";
  return `...${key.slice(-6)}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

// ─────────────────────────────────────────────────────────────
// POST /whatsapp/sessions
// Configure (or re-configure) a Meta WhatsApp Cloud API session for an entity.
// ─────────────────────────────────────────────────────────────
router.post("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const {
      entity_id,
      entity_name,
      parent_entity_id,
      connection_type,
      meta_api_key,
      meta_phone_number_id,
      meta_business_account_id,
    } = req.body;

    const normalizedEntityId = normalizeEntityId(entity_id);
    const normalizedParentEntityId = normalizeEntityId(parent_entity_id);

    if (!normalizedEntityId) {
      return res.status(400).json({ error: "Required: entity_id" });
    }

    if (
      normalizedParentEntityId &&
      normalizedParentEntityId === normalizedEntityId
    ) {
      return res.status(400).json({
        error: "parent_entity_id must be different from entity_id",
      });
    }

    if (connection_type && connection_type !== "meta") {
      return res.status(400).json({
        error: "Invalid connection_type. Only 'meta' is supported",
      });
    }

    if (!meta_api_key) {
      return res.status(400).json({
        error: "Required: meta_api_key",
      });
    }

    if (!meta_phone_number_id) {
      return res.status(400).json({
        error: "Required: meta_phone_number_id",
      });
    }

    const sql = getDb();
    const sessionName = buildSessionName(appId, normalizedEntityId);

    await sql`
      INSERT INTO whatsapp_sessions (
        app_id,
        entity_id,
        parent_entity_id,
        waha_session,
        status,
        qr_code,
        connection_type,
        meta_api_key,
        meta_phone_number_id,
        meta_business_account_id,
        connected_at,
        disconnected_at
      )
      VALUES (
        ${appId},
        ${normalizedEntityId},
        ${normalizedParentEntityId || null},
        ${sessionName},
        'active',
        NULL,
        'meta',
        ${meta_api_key},
        ${meta_phone_number_id},
        ${meta_business_account_id || null},
        now(),
        NULL
      )
      ON CONFLICT (app_id, entity_id) DO UPDATE SET
        parent_entity_id = EXCLUDED.parent_entity_id,
        waha_session = EXCLUDED.waha_session,
        status = 'active',
        qr_code = NULL,
        connection_type = 'meta',
        meta_api_key = EXCLUDED.meta_api_key,
        meta_phone_number_id = EXCLUDED.meta_phone_number_id,
        meta_business_account_id = EXCLUDED.meta_business_account_id,
        connected_at = now(),
        disconnected_at = NULL
    `;

    return res.status(201).json({
      success: true,
      entity_id: normalizedEntityId,
      resolved_entity_id: normalizedEntityId,
      parent_entity_id: normalizedParentEntityId || null,
      is_inherited: false,
      entity_name: entity_name || normalizedEntityId,
      status: "active",
      connection_type: "meta",
      session_name: sessionName,
      waha_session: sessionName,
      message: "Meta WhatsApp API configured successfully",
    });
  } catch (err) {
    console.error("[whatsapp-sessions] POST error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /whatsapp/sessions
// List all Meta WhatsApp sessions for the authenticated app.
// Optional query params: ?status=active
// ─────────────────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
  try {
    const appId = req.appId;
    const { status } = req.query;
    const sql = getDb();

    const rows = status
      ? await sql`
          SELECT
            entity_id,
            parent_entity_id,
            waha_session AS session_name,
            waha_session,
            status,
            phone_number,
            connection_type,
            connected_at,
            disconnected_at,
            created_at,
            meta_phone_number_id,
            meta_business_account_id
          FROM whatsapp_sessions
          WHERE app_id = ${appId}
            AND connection_type = 'meta'
            AND status = ${status}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT
            entity_id,
            parent_entity_id,
            waha_session AS session_name,
            waha_session,
            status,
            phone_number,
            connection_type,
            connected_at,
            disconnected_at,
            created_at,
            meta_phone_number_id,
            meta_business_account_id
          FROM whatsapp_sessions
          WHERE app_id = ${appId}
            AND connection_type = 'meta'
          ORDER BY created_at DESC
        `;

    return res.json({
      success: true,
      count: rows.length,
      sessions: rows,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] GET /sessions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /whatsapp/sessions/:entity_id
// Fetch one Meta WhatsApp session status, with optional parent fallback.
// ─────────────────────────────────────────────────────────────
router.get("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const parentEntityId = normalizeEntityId(req.query.parent_entity_id);
    const sql = getDb();

    const { session, isInherited } = await resolveWhatsAppSession(sql, {
      appId,
      entityId: entity_id,
      parentEntityId,
    });

    if (!session) {
      return res.json({ success: true, status: "not_configured" });
    }

    if (session.connection_type !== "meta") {
      return res.json({
        success: true,
        status: "not_configured",
      });
    }

    return res.json({
      success: true,
      entity_id: session.entity_id,
      resolved_entity_id: session.entity_id,
      is_inherited: isInherited,
      parent_entity_id: session.parent_entity_id || parentEntityId || null,
      session_name: session.session_name,
      waha_session: session.waha_session,
      status: session.status,
      phone_number: session.phone_number,
      connected_at: session.connected_at,
      disconnected_at: session.disconnected_at,
      created_at: session.created_at,
      connection_type: "meta",
      meta_api_key: maskApiKey(session.meta_api_key),
      meta_phone_number_id: session.meta_phone_number_id,
      meta_business_account_id: session.meta_business_account_id,
    });
  } catch (err) {
    console.error("[whatsapp-sessions] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /whatsapp/sessions/:entity_id
// Disconnect a Meta WhatsApp session and clear stored API key.
// ─────────────────────────────────────────────────────────────
router.delete("/sessions/:entity_id", async (req, res) => {
  try {
    const appId = req.appId;
    const entityId = normalizeEntityId(req.params.entity_id);
    const sql = getDb();

    const rows = await sql`
      SELECT entity_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
        AND connection_type = 'meta'
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    await sql`
      UPDATE whatsapp_sessions
      SET
        status = 'disconnected',
        disconnected_at = now(),
        qr_code = NULL,
        meta_api_key = NULL
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("[whatsapp-sessions] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /whatsapp/sessions/:entity_id/test-message
// Send a test WhatsApp message via Meta Cloud API, using parent fallback
// when the entity itself has no active credentials.
// ─────────────────────────────────────────────────────────────
router.post("/sessions/:entity_id/test-message", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id } = req.params;
    const { phone, message, parent_entity_id } = req.body;
    const parentEntityId = normalizeEntityId(parent_entity_id);

    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || !/^\d{7,15}$/.test(cleanPhone)) {
      return res.status(400).json({
        error:
          "Required: phone - digits only, international format without + (e.g. 919876543210)",
      });
    }

    const sql = getDb();

    const { session, isInherited } = await resolveWhatsAppSession(sql, {
      appId,
      entityId: entity_id,
      parentEntityId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.connection_type !== "meta") {
      return res.status(409).json({
        error: "Unsupported connection type for this session",
      });
    }

    if (session.status !== "active") {
      return res.status(409).json({
        error: "Session is not active - configure Meta credentials to activate",
      });
    }

    const text =
      message?.trim() ||
      "Hello! This is a test message from BlueMQ. Your Meta WhatsApp integration is working correctly.";

    const metaProvider = getWhatsAppProvider();
    const result = await metaProvider.sendWhatsApp({
      metaApiKey: session.meta_api_key,
      metaPhoneNumberId: session.meta_phone_number_id,
      user: { phone: cleanPhone },
      body: text,
    });

    if (!result.success) {
      return res
        .status(502)
        .json({ error: `Failed to send message: ${result.error}` });
    }

    return res.json({
      success: true,
      sent_to: cleanPhone,
      resolved_entity_id: session.entity_id,
      parent_entity_id: session.parent_entity_id || parentEntityId || null,
      is_inherited: isInherited,
      provider: "meta-whatsapp",
      message_id: result.providerMessageId,
    });
  } catch (err) {
    const errorMsg =
      err.response?.data?.message || err.response?.data?.error || err.message;
    console.error("[whatsapp-sessions] Test message error:", errorMsg);
    return res
      .status(502)
      .json({ error: `Failed to send message: ${errorMsg}` });
  }
});

module.exports = router;
