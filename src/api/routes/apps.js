const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { getDb } = require("../../db");
const config = require("../../config");

const router = Router();

/**
 * POST /apps/register
 *
 * Register a new app / client. Protected by SERVICE_API_KEY_SECRET
 * (only the service admin should call this).
 *
 * Body: { app_id: "tutrsy", name: "Tutrsy App" }
 * Returns: { api_key: "generated-key" }
 */
router.post("/register", async (req, res) => {
  try {
    // Protect with service-level secret
    const secret = req.headers["x-service-secret"];
    if (secret !== config.serviceApiKeySecret) {
      return res
        .status(403)
        .json({ error: "Forbidden — invalid service secret" });
    }

    const { app_id, name } = req.body;
    if (!app_id || !name) {
      return res.status(400).json({ error: "Required: app_id, name" });
    }

    // Generate a secure API key
    const apiKey = `bmq_${crypto.randomBytes(32).toString("hex")}`;

    const sql = getDb();
    await sql`
      INSERT INTO apps (app_id, name, api_key)
      VALUES (${app_id}, ${name}, ${apiKey})
      ON CONFLICT (app_id) DO NOTHING
    `;

    return res.status(201).json({ success: true, app_id, api_key: apiKey });
  } catch (err) {
    console.error("[apps] register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
