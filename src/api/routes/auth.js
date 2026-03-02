const { Router } = require("express");
const crypto = require("crypto");
const { getDb } = require("../../db");
const config = require("../../config");

const router = Router();

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/** Generate a 6-digit numeric OTP */
function generateOTP() {
  return String(crypto.randomInt(100000, 999999));
}

/** Send OTP email via Resend */
async function sendOTPEmail(to, code, purpose) {
  const { Resend } = require("resend");
  const resend = new Resend(config.resend.apiKey);

  const subject =
    purpose === "register"
      ? `${code} — Verify your email to register on BlueMQ`
      : `${code} — Login to BlueMQ`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: #4f46e5; color: #fff; font-size: 22px; font-weight: 700; line-height: 48px;">B</div>
      </div>
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111827; text-align: center;">
        ${purpose === "register" ? "Verify your email" : "Login to BlueMQ"}
      </h2>
      <p style="margin: 0 0 24px; font-size: 14px; color: #6b7280; text-align: center;">
        Enter this code to continue. It expires in 10 minutes.
      </p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</span>
      </div>
      <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  const result = await resend.emails.send({
    from: config.resend.fromEmail,
    to,
    subject,
    html,
  });

  if (result.error) {
    console.error("[auth] Resend error:", result.error);
    throw new Error("Failed to send OTP email");
  }

  return result;
}

// ────────────────────────────────────────────────────────
// POST /auth/register/send-otp
// Body: { email, app_name, app_id }
// ────────────────────────────────────────────────────────
router.post("/register/send-otp", async (req, res) => {
  try {
    const { email, app_name, app_id } = req.body;

    if (!email || !app_name || !app_id) {
      return res
        .status(400)
        .json({ error: "Required: email, app_name, app_id" });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    const sql = getDb();

    // Check if app_id already exists
    const existing = await sql`
      SELECT app_id FROM apps WHERE app_id = ${app_id} LIMIT 1
    `;
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: "App ID already registered. Use login instead." });
    }

    // Invalidate previous unused OTPs for this email+purpose
    await sql`
      UPDATE otps
      SET verified = true
      WHERE email = ${email.toLowerCase()} AND purpose = 'register' AND verified = false
    `;

    // Generate & store OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await sql`
      INSERT INTO otps (email, code, purpose, app_id, app_name, expires_at)
      VALUES (${email.toLowerCase()}, ${code}, 'register', ${app_id}, ${app_name}, ${expiresAt.toISOString()})
    `;

    // Send via Resend
    await sendOTPEmail(email, code, "register");

    console.log(`[auth] Register OTP sent to ${email} for app ${app_id}`);
    return res.json({ success: true, message: "OTP sent to your email" });
  } catch (err) {
    console.error("[auth] register/send-otp error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────
// POST /auth/register/verify-otp
// Body: { email, code }
// ────────────────────────────────────────────────────────
router.post("/register/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Required: email, code" });
    }

    const sql = getDb();

    // Find the most recent unverified OTP for this email
    const rows = await sql`
      SELECT id, code, app_id, app_name, expires_at
      FROM otps
      WHERE email = ${email.toLowerCase()}
        AND purpose = 'register'
        AND verified = false
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ error: "No pending OTP found. Request a new one." });
    }

    const otp = rows[0];

    // Check expiry
    if (new Date(otp.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ error: "OTP has expired. Request a new one." });
    }

    // Check code
    if (otp.code !== code.trim()) {
      return res.status(400).json({ error: "Invalid OTP code" });
    }

    // Mark as verified
    await sql`UPDATE otps SET verified = true WHERE id = ${otp.id}`;

    // Create the app — SERVICE_API_KEY_SECRET is never exposed, used server-side only
    const apiKey = `bmq_${crypto.randomBytes(32).toString("hex")}`;

    await sql`
      INSERT INTO apps (app_id, name, email, api_key)
      VALUES (${otp.app_id}, ${otp.app_name}, ${email.toLowerCase()}, ${apiKey})
      ON CONFLICT (app_id) DO NOTHING
    `;

    console.log(`[auth] App registered: ${otp.app_id} (${email})`);
    return res.status(201).json({
      success: true,
      app_id: otp.app_id,
      app_name: otp.app_name,
      api_key: apiKey,
    });
  } catch (err) {
    console.error("[auth] register/verify-otp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────
// POST /auth/login/send-otp
// Body: { email }
// ────────────────────────────────────────────────────────
router.post("/login/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Required: email" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    const sql = getDb();

    // Check if an app exists for this email
    const apps = await sql`
      SELECT app_id, name FROM apps WHERE email = ${email.toLowerCase()} LIMIT 1
    `;

    if (apps.length === 0) {
      return res
        .status(404)
        .json({ error: "No app found for this email. Register first." });
    }

    // Invalidate previous unused OTPs
    await sql`
      UPDATE otps
      SET verified = true
      WHERE email = ${email.toLowerCase()} AND purpose = 'login' AND verified = false
    `;

    // Generate & store OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sql`
      INSERT INTO otps (email, code, purpose, expires_at)
      VALUES (${email.toLowerCase()}, ${code}, 'login', ${expiresAt.toISOString()})
    `;

    // Send via Resend
    await sendOTPEmail(email, code, "login");

    console.log(`[auth] Login OTP sent to ${email}`);
    return res.json({ success: true, message: "OTP sent to your email" });
  } catch (err) {
    console.error("[auth] login/send-otp error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────
// POST /auth/login/verify-otp
// Body: { email, code }
// ────────────────────────────────────────────────────────
router.post("/login/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Required: email, code" });
    }

    const sql = getDb();

    // Find the most recent unverified login OTP
    const rows = await sql`
      SELECT id, code, expires_at
      FROM otps
      WHERE email = ${email.toLowerCase()}
        AND purpose = 'login'
        AND verified = false
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ error: "No pending OTP found. Request a new one." });
    }

    const otp = rows[0];

    if (new Date(otp.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ error: "OTP has expired. Request a new one." });
    }

    if (otp.code !== code.trim()) {
      return res.status(400).json({ error: "Invalid OTP code" });
    }

    // Mark as verified
    await sql`UPDATE otps SET verified = true WHERE id = ${otp.id}`;

    // Fetch app details
    const apps = await sql`
      SELECT app_id, name, api_key FROM apps WHERE email = ${email.toLowerCase()} LIMIT 1
    `;

    if (apps.length === 0) {
      return res.status(404).json({ error: "App not found" });
    }

    const app = apps[0];

    console.log(`[auth] Login verified for ${email} (${app.app_id})`);
    return res.json({
      success: true,
      app_id: app.app_id,
      app_name: app.name,
      api_key: app.api_key,
    });
  } catch (err) {
    console.error("[auth] login/verify-otp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
