const { Router } = require("express");
const { getDb } = require("../../db");
const { authMiddleware } = require("../middlewares/auth");
const { clearAppProviderCache } = require("../../providers/per-app-factory");

const router = Router();

const SECRET_FIELDS = [
  "firebase_private_key",
  "onesignal_api_key",
  "resend_api_key",
  "twilio_auth_token",
  "msg91_auth_key",
];

const PROVIDER_OPTIONS = {
  push: [null, "firebase", "onesignal"],
  email: [null, "resend", "onesignal", "msg91"],
  sms: [null, "onesignal", "twilio", "msg91"],
  whatsapp: [null, "meta", "msg91"],
  call: [null, "msg91"],
};

function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function maskRow(row) {
  if (!row) return null;
  const masked = { ...row };
  for (const field of SECRET_FIELDS) {
    if (masked[field]) {
      masked[`${field}_masked`] = maskSecret(masked[field]);
      masked[`has_${field}`] = true;
      delete masked[field];
    } else {
      masked[`has_${field}`] = false;
    }
  }
  return masked;
}

function isProvided(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function validateProviderChoice(res, fieldName, value, validValues) {
  if (value === undefined || validValues.includes(value)) {
    return true;
  }

  res.status(400).json({
    error: `Invalid ${fieldName}. Allowed: ${validValues.filter(Boolean).join(", ")}`,
  });
  return false;
}

async function getExistingCredentials(sql, appId) {
  const rows = await sql`
    SELECT
      provider_push,
      provider_email,
      provider_sms,
      provider_whatsapp,
      provider_call,
      firebase_project_id,
      firebase_client_email,
      firebase_private_key,
      onesignal_app_id,
      onesignal_api_key,
      resend_api_key,
      resend_from_email,
      twilio_account_sid,
      twilio_auth_token,
      twilio_from_number,
      msg91_auth_key,
      msg91_whatsapp_number,
      msg91_flow_base_url,
      msg91_sms_flow_id,
      msg91_email_flow_id,
      msg91_call_flow_id
    FROM app_provider_credentials
    WHERE app_id = ${appId}
    LIMIT 1
  `;

  return rows[0] || null;
}

// ─────────────────────────────────────────────
//  GET /settings/credentials
// ─────────────────────────────────────────────
router.get("/credentials", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        provider_push,
        provider_email,
        provider_sms,
        provider_whatsapp,
        provider_call,
        firebase_project_id,
        firebase_client_email,
        firebase_private_key,
        onesignal_app_id,
        onesignal_api_key,
        resend_api_key,
        resend_from_email,
        twilio_account_sid,
        twilio_auth_token,
        twilio_from_number,
        msg91_auth_key,
        msg91_whatsapp_number,
        msg91_flow_base_url,
        msg91_sms_flow_id,
        msg91_email_flow_id,
        msg91_call_flow_id,
        updated_at
      FROM app_provider_credentials
      WHERE app_id = ${req.appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.json({
        configured: false,
        credentials: null,
      });
    }

    return res.json({
      configured: true,
      credentials: maskRow(rows[0]),
    });
  } catch (err) {
    console.error("[settings] get credentials error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────
//  PUT /settings/credentials
// ─────────────────────────────────────────────
router.put("/credentials", authMiddleware, async (req, res) => {
  try {
    const {
      provider_push,
      provider_email,
      provider_sms,
      provider_whatsapp,
      provider_call,
      firebase_project_id,
      firebase_client_email,
      firebase_private_key,
      onesignal_app_id,
      onesignal_api_key,
      resend_api_key,
      resend_from_email,
      twilio_account_sid,
      twilio_auth_token,
      twilio_from_number,
      msg91_auth_key,
      msg91_whatsapp_number,
      msg91_flow_base_url,
      msg91_sms_flow_id,
      msg91_email_flow_id,
      msg91_call_flow_id,
    } = req.body;

    if (
      !validateProviderChoice(
        res,
        "provider_push",
        provider_push,
        PROVIDER_OPTIONS.push,
      ) ||
      !validateProviderChoice(
        res,
        "provider_email",
        provider_email,
        PROVIDER_OPTIONS.email,
      ) ||
      !validateProviderChoice(res, "provider_sms", provider_sms, PROVIDER_OPTIONS.sms) ||
      !validateProviderChoice(
        res,
        "provider_whatsapp",
        provider_whatsapp,
        PROVIDER_OPTIONS.whatsapp,
      ) ||
      !validateProviderChoice(
        res,
        "provider_call",
        provider_call,
        PROVIDER_OPTIONS.call,
      )
    ) {
      return;
    }

    const sql = getDb();
    const existing = await getExistingCredentials(sql, req.appId);
    const incoming = req.body;

    const getFieldValue = (field) => {
      if (Object.prototype.hasOwnProperty.call(incoming, field)) {
        return incoming[field];
      }
      return existing?.[field];
    };

    const ensureFields = (label, fields) => {
      const missing = fields.filter((field) => !isProvided(getFieldValue(field)));
      if (missing.length > 0) {
        return `${label} credentials are incomplete. Missing: ${missing.join(", ")}`;
      }
      return null;
    };

    if (provider_push === "firebase") {
      const errMsg = ensureFields("Firebase", [
        "firebase_project_id",
        "firebase_client_email",
        "firebase_private_key",
      ]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (
      provider_push === "onesignal" ||
      provider_email === "onesignal" ||
      provider_sms === "onesignal"
    ) {
      const errMsg = ensureFields("OneSignal", [
        "onesignal_app_id",
        "onesignal_api_key",
      ]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (provider_email === "resend") {
      const errMsg = ensureFields("Resend", ["resend_api_key"]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (provider_sms === "twilio") {
      const errMsg = ensureFields("Twilio", [
        "twilio_account_sid",
        "twilio_auth_token",
        "twilio_from_number",
      ]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    const msg91Selected =
      provider_email === "msg91" ||
      provider_sms === "msg91" ||
      provider_whatsapp === "msg91" ||
      provider_call === "msg91";

    if (msg91Selected) {
      const commonMsgErr = ensureFields("MSG91", ["msg91_auth_key"]);
      if (commonMsgErr) return res.status(400).json({ error: commonMsgErr });
    }

    if (provider_sms === "msg91") {
      const errMsg = ensureFields("MSG91 SMS", ["msg91_sms_flow_id"]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (provider_email === "msg91") {
      const errMsg = ensureFields("MSG91 Email", ["msg91_email_flow_id"]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (provider_whatsapp === "msg91") {
      const errMsg = ensureFields("MSG91 WhatsApp", ["msg91_whatsapp_number"]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (provider_call === "msg91") {
      const errMsg = ensureFields("MSG91 Call", ["msg91_call_flow_id"]);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    const updates = {};

    if (provider_push !== undefined) updates.provider_push = provider_push;
    if (provider_email !== undefined) updates.provider_email = provider_email;
    if (provider_sms !== undefined) updates.provider_sms = provider_sms;
    if (provider_whatsapp !== undefined) updates.provider_whatsapp = provider_whatsapp;
    if (provider_call !== undefined) updates.provider_call = provider_call;

    if (firebase_project_id !== undefined) updates.firebase_project_id = firebase_project_id;
    if (firebase_client_email !== undefined) updates.firebase_client_email = firebase_client_email;
    if (firebase_private_key !== undefined) updates.firebase_private_key = firebase_private_key;

    if (onesignal_app_id !== undefined) updates.onesignal_app_id = onesignal_app_id;
    if (onesignal_api_key !== undefined) updates.onesignal_api_key = onesignal_api_key;

    if (resend_api_key !== undefined) updates.resend_api_key = resend_api_key;
    if (resend_from_email !== undefined) updates.resend_from_email = resend_from_email;

    if (twilio_account_sid !== undefined) updates.twilio_account_sid = twilio_account_sid;
    if (twilio_auth_token !== undefined) updates.twilio_auth_token = twilio_auth_token;
    if (twilio_from_number !== undefined) updates.twilio_from_number = twilio_from_number;

    if (msg91_auth_key !== undefined) updates.msg91_auth_key = msg91_auth_key;
    if (msg91_whatsapp_number !== undefined) {
      updates.msg91_whatsapp_number = msg91_whatsapp_number;
    }
    if (msg91_flow_base_url !== undefined) updates.msg91_flow_base_url = msg91_flow_base_url;
    if (msg91_sms_flow_id !== undefined) updates.msg91_sms_flow_id = msg91_sms_flow_id;
    if (msg91_email_flow_id !== undefined) updates.msg91_email_flow_id = msg91_email_flow_id;
    if (msg91_call_flow_id !== undefined) updates.msg91_call_flow_id = msg91_call_flow_id;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const columns = Object.keys(updates);
    const values = Object.values(updates);

    const insertCols = ["app_id", ...columns, "updated_at"].join(", ");
    const insertPlaceholders = [
      "$1",
      ...columns.map((_, i) => `$${i + 2}`),
      "now()",
    ].join(", ");

    const updateSet = columns
      .map((col, i) => `${col} = $${i + 2}`)
      .concat("updated_at = now()")
      .join(", ");

    const query = `
      INSERT INTO app_provider_credentials (${insertCols})
      VALUES (${insertPlaceholders})
      ON CONFLICT (app_id) DO UPDATE SET ${updateSet}
      RETURNING provider_push, provider_email, provider_sms, provider_whatsapp, provider_call, updated_at
    `;

    const result = await sql.query(query, [req.appId, ...values]);

    clearAppProviderCache(req.appId);

    console.log(
      `[settings] Credentials updated for app ${req.appId}:`,
      columns.filter((c) => !SECRET_FIELDS.includes(c)).join(", "),
    );

    return res.json({
      success: true,
      routing: {
        provider_push: result.rows[0]?.provider_push || null,
        provider_email: result.rows[0]?.provider_email || null,
        provider_sms: result.rows[0]?.provider_sms || null,
        provider_whatsapp: result.rows[0]?.provider_whatsapp || null,
        provider_call: result.rows[0]?.provider_call || null,
      },
    });
  } catch (err) {
    console.error("[settings] update credentials error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
