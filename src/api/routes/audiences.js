const { Router } = require("express");
const { getDb } = require("../../db");

const router = Router();

// ─── Helpers ───────────────────────────────────────────────

function normalizeName(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      name: String(m.name || "").trim() || undefined,
      email: String(m.email || "").trim() || undefined,
      phone: String(m.phone || "").trim() || undefined,
      user_id: String(m.user_id || "").trim() || undefined,
      onesignal_player_id:
        String(m.onesignal_player_id || "").trim() || undefined,
      fcm_token: String(m.fcm_token || "").trim() || undefined,
    }))
    .map((m) => {
      // Remove undefined keys to keep JSON clean
      return Object.fromEntries(
        Object.entries(m).filter(([, v]) => v !== undefined),
      );
    });
}

// ─── GET /audiences ─────────────────────────────────────────

/**
 * List all audiences for the authenticated app.
 * Returns id, name, description, member count, timestamps — NOT full members array.
 */
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const sql = getDb();

    const rows = await sql`
      SELECT
        id,
        name,
        description,
        jsonb_array_length(members) AS member_count,
        created_at,
        updated_at
      FROM audiences
      WHERE app_id = ${appId}
      ORDER BY updated_at DESC
    `;

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[audiences] GET / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /audiences/:id ─────────────────────────────────────

/**
 * Get a single audience including all members.
 */
router.get("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT *
      FROM audiences
      WHERE id = ${id} AND app_id = ${appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("[audiences] GET /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /audiences ─────────────────────────────────────────

/**
 * Create a new audience.
 *
 * Body: { name, description?, members? }
 * members: [{ name?, email?, phone?, user_id?, onesignal_player_id?, fcm_token? }]
 */
router.post("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { name, description, members } = req.body;

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return res.status(400).json({ error: "Required: name" });
    }

    const normalizedMembers = normalizeMembers(members);
    const normalizedDescription = description
      ? String(description).trim() || null
      : null;

    const sql = getDb();

    const rows = await sql`
      INSERT INTO audiences (app_id, name, description, members)
      VALUES (
        ${appId},
        ${normalizedName},
        ${normalizedDescription},
        ${JSON.stringify(normalizedMembers)}
      )
      RETURNING *
    `;

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "An audience with this name already exists",
      });
    }
    console.error("[audiences] POST / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /audiences/:id ──────────────────────────────────────

/**
 * Update an audience (name, description, or replace members array).
 */
router.put("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const { name, description, members } = req.body;

    const sql = getDb();

    // Fetch existing
    const existingRows = await sql`
      SELECT * FROM audiences WHERE id = ${id} AND app_id = ${appId} LIMIT 1
    `;
    if (existingRows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }
    const existing = existingRows[0];

    const finalName =
      name !== undefined ? normalizeName(name) : existing.name;
    if (!finalName) {
      return res.status(400).json({ error: "name cannot be empty" });
    }

    const finalDescription =
      description !== undefined
        ? String(description || "").trim() || null
        : existing.description;

    const finalMembers =
      members !== undefined
        ? normalizeMembers(members)
        : existing.members;

    const rows = await sql`
      UPDATE audiences
      SET
        name        = ${finalName},
        description = ${finalDescription},
        members     = ${JSON.stringify(finalMembers)},
        updated_at  = now()
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING *
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "An audience with this name already exists",
      });
    }
    console.error("[audiences] PUT /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /audiences/:id ───────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const sql = getDb();

    const rows = await sql`
      DELETE FROM audiences
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[audiences] DELETE /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
