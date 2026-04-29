const { Router } = require("express");
const { getDb } = require("../../db");
const { authMiddleware } = require("../middlewares/auth");
const { clearAppProviderCache } = require("../../providers/per-app-factory");

const router = Router();

// Fields that contain secrets — returned masked to the frontend
const SECRET_FIELDS = [
  "firebase_private_key",
  "onesignal_api_key",
  "resend_api_key",
];

/**
 * Mask a secret string for display.
 * Shows first 6 and last 4 chars: "bmq_ab...xyz9"
 */
function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Mask secret fields in a credentials row.
 */
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

// ─────────────────────────────────────────────
//  GET /settings/credentials
//  Returns current provider config (secrets masked)
// ─────────────────────────────────────────────
router.get("/credentials", authMiddleware, async (req, res) => {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        provider_push,
        provider_email,
        provider_sms,
        firebase_project_id,
        firebase_client_email,
        firebase_private_key,
        onesignal_app_id,
        onesignal_api_key,
        resend_api_key,
        resend_from_email,
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
//  Upsert provider credentials and routing
// ─────────────────────────────────────────────
router.put("/credentials", authMiddleware, async (req, res) => {
  try {
    const {
      provider_push,
      provider_email,
      provider_sms,
      firebase_project_id,
      firebase_client_email,
      firebase_private_key,
      onesignal_app_id,
      onesignal_api_key,
      resend_api_key,
      resend_from_email,
    } = req.body;

    // Validate provider choices
    const validPush = [null, "firebase", "onesignal"];
    const validEmail = [null, "resend", "onesignal"];
    const validSms = [null, "onesignal"];

    if (provider_push !== undefined && !validPush.includes(provider_push)) {
      return res.status(400).json({
        error: `Invalid provider_push. Allowed: ${validPush.filter(Boolean).join(", ")}`,
      });
    }
    if (provider_email !== undefined && !validEmail.includes(provider_email)) {
      return res.status(400).json({
        error: `Invalid provider_email. Allowed: ${validEmail.filter(Boolean).join(", ")}`,
      });
    }
    if (provider_sms !== undefined && !validSms.includes(provider_sms)) {
      return res.status(400).json({
        error: `Invalid provider_sms. Allowed: ${validSms.filter(Boolean).join(", ")}`,
      });
    }

    // Validate that credentials are provided for chosen providers
    if (provider_push === "firebase") {
      if (!firebase_project_id && !firebase_client_email && !firebase_private_key) {
        // Check if existing credentials are already stored
        const sql = getDb();
        const existing = await sql`
          SELECT firebase_project_id FROM app_provider_credentials
          WHERE app_id = ${req.appId} AND firebase_project_id IS NOT NULL
          LIMIT 1
        `;
        if (existing.length === 0) {
          return res.status(400).json({
            error: "Firebase credentials (project_id, client_email, private_key) are required when using Firebase as push provider",
          });
        }
      }
    }

    if (
      (provider_push === "onesignal" ||
        provider_email === "onesignal" ||
        provider_sms === "onesignal")
    ) {
      if (!onesignal_app_id && !onesignal_api_key) {
        const sql = getDb();
        const existing = await sql`
          SELECT onesignal_app_id FROM app_provider_credentials
          WHERE app_id = ${req.appId} AND onesignal_app_id IS NOT NULL
          LIMIT 1
        `;
        if (existing.length === 0) {
          return res.status(400).json({
            error: "OneSignal credentials (app_id, api_key) are required when using OneSignal as a provider",
          });
        }
      }
    }

    if (provider_email === "resend") {
      if (!resend_api_key) {
        const sql = getDb();
        const existing = await sql`
          SELECT resend_api_key FROM app_provider_credentials
          WHERE app_id = ${req.appId} AND resend_api_key IS NOT NULL
          LIMIT 1
        `;
        if (existing.length === 0) {
          return res.status(400).json({
            error: "Resend API key is required when using Resend as email provider",
          });
        }
      }
    }

    const sql = getDb();

    // Build the SET clause dynamically — only update fields that are provided
    // (so partial updates don't wipe existing credentials)
    const updates = {};

    if (provider_push !== undefined) updates.provider_push = provider_push;
    if (provider_email !== undefined) updates.provider_email = provider_email;
    if (provider_sms !== undefined) updates.provider_sms = provider_sms;

    if (firebase_project_id !== undefined) updates.firebase_project_id = firebase_project_id;
    if (firebase_client_email !== undefined) updates.firebase_client_email = firebase_client_email;
    if (firebase_private_key !== undefined) updates.firebase_private_key = firebase_private_key;

    if (onesignal_app_id !== undefined) updates.onesignal_app_id = onesignal_app_id;
    if (onesignal_api_key !== undefined) updates.onesignal_api_key = onesignal_api_key;

    if (resend_api_key !== undefined) updates.resend_api_key = resend_api_key;
    if (resend_from_email !== undefined) updates.resend_from_email = resend_from_email;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    // Build parameterized upsert
    const columns = Object.keys(updates);
    const values = Object.values(updates);

    // Include app_id for INSERT
    const insertCols = ["app_id", ...columns, "updated_at"].join(", ");
    const insertPlaceholders = [
      `$1`,
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
      RETURNING provider_push, provider_email, provider_sms, updated_at
    `;

    const result = await sql.query(query, [req.appId, ...values]);

    // Clear cached provider instances for this app
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
      },
    });
  } catch (err) {
    console.error("[settings] update credentials error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
