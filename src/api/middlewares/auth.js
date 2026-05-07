const { getDb } = require("../../db");
const { setRequestContext } = require("../../logger");

/**
 * Middleware: validate `x-api-key` header.
 *
 * Looks up the key in the `apps` table and attaches `req.app_id`
 * for downstream use.
 */
async function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT app_id, name FROM apps WHERE api_key = ${apiKey} LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.appId = rows[0].app_id;
    req.appName = rows[0].name;
    setRequestContext({ appId: req.appId });
    next();
  } catch (err) {
    console.error("[auth] DB lookup failed:", err.message);
    return res.status(500).json({ error: "Auth service error" });
  }
}

module.exports = { authMiddleware };
