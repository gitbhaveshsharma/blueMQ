"use strict";

/**
 * Quota management API — CRUD for quota profiles, limits, and owner overrides.
 *
 * Routes:
 *   GET    /quota/usage           — current period usage summary for the app
 *   GET    /quota/profiles        — list profiles for this app
 *   POST   /quota/profiles        — create a profile
 *   PUT    /quota/profiles/:id    — update a profile (rename, set default)
 *   DELETE /quota/profiles/:id    — delete a profile
 *   POST   /quota/profiles/:id/limits       — upsert a channel limit
 *   DELETE /quota/profiles/:id/limits/:channel — remove a channel limit
 *   GET    /quota/owners          — list owner_quota rows for this app
 *   PUT    /quota/owners/:ownerId — upsert owner quota (profile + overrides)
 *   DELETE /quota/owners/:ownerId — remove owner quota row
 *   GET    /quota/thresholds      — recent threshold events
 *   GET    /quota/webhooks/deliveries — webhook delivery history
 *   POST   /quota/webhooks/deliveries/:id/retry — dashboard retry
 */

const { Router } = require("express");
const { getDb } = require("../../db");
const { invalidateQuotaCache } = require("../../utils/quota");

const router = Router();

// ─── Usage ────────────────────────────────────────────────────────────────────

/**
 * GET /quota/usage
 * Returns current period quota usage for all (owner, channel) pairs for this app.
 * Optionally filter by owner_id or channel query params.
 */
router.get("/usage", async (req, res) => {
  try {
    const appId = req.appId;
    const sql = getDb();
    const { owner_id, channel, period_start } = req.query;

    const params = [appId];
    const where = ["qu.app_id = $1"];

    if (owner_id) {
      params.push(owner_id);
      where.push(`qu.owner_id = $${params.length}`);
    }
    if (channel) {
      params.push(channel);
      where.push(`qu.channel = $${params.length}`);
    }
    if (period_start) {
      params.push(period_start);
      where.push(`qu.period_start = $${params.length}`);
    }

    const res2 = await sql.query(
      `SELECT qu.owner_id, qu.channel, qu.period_start,
              qu.used, qu.reserved, qu.used + qu.reserved AS total_committed,
              qu.updated_at,
              oq.profile_id,
              qpl.limit_count AS "limit",
              qpl.period
       FROM quota_usage qu
       LEFT JOIN owner_quota oq ON oq.app_id = qu.app_id AND oq.owner_id = qu.owner_id
       LEFT JOIN quota_profile_limits qpl
         ON qpl.profile_id = oq.profile_id AND qpl.channel = qu.channel
       WHERE ${where.join(" AND ")}
       ORDER BY qu.owner_id, qu.channel, qu.period_start DESC`,
      params
    );

    return res.json({ usage: res2.rows });
  } catch (err) {
    console.error("[quota] GET /usage error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Profiles ─────────────────────────────────────────────────────────────────

router.get("/profiles", async (req, res) => {
  try {
    const sql = getDb();
    const profiles = await sql.query(
      `SELECT p.id, p.name, p.is_default, p.created_at,
              COALESCE(
                json_agg(json_build_object(
                  'channel', l.channel, 'limit_count', l.limit_count, 'period', l.period
                )) FILTER (WHERE l.channel IS NOT NULL),
                '[]'
              ) AS limits
       FROM quota_profiles p
       LEFT JOIN quota_profile_limits l ON l.profile_id = p.id
       WHERE p.app_id = $1
       GROUP BY p.id
       ORDER BY p.is_default DESC, p.name`,
      [req.appId]
    );
    return res.json({ profiles: profiles.rows });
  } catch (err) {
    console.error("[quota] GET /profiles error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles", async (req, res) => {
  try {
    const { name, is_default = false } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const sql = getDb();

    // If setting as default, clear existing default first
    if (is_default) {
      await sql.query(
        `UPDATE quota_profiles SET is_default = false WHERE app_id = $1 AND is_default = true`,
        [req.appId]
      );
    }

    const result = await sql.query(
      `INSERT INTO quota_profiles (app_id, name, is_default)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.appId, name.trim(), Boolean(is_default)]
    );

    invalidateQuotaCache(req.appId);
    return res.status(201).json({ profile: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "A profile with that name already exists" });
    }
    console.error("[quota] POST /profiles error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/profiles/:id", async (req, res) => {
  try {
    const sql = getDb();
    const { name, is_default } = req.body;

    // Verify ownership
    const existing = await sql.query(
      `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [req.params.id, req.appId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (is_default === true) {
      await sql.query(
        `UPDATE quota_profiles SET is_default = false WHERE app_id = $1`,
        [req.appId]
      );
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      params.push(name.trim());
      updates.push(`name = $${params.length}`);
    }
    if (is_default !== undefined) {
      params.push(Boolean(is_default));
      updates.push(`is_default = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    params.push(req.params.id);
    const result = await sql.query(
      `UPDATE quota_profiles SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    invalidateQuotaCache(req.appId);
    return res.json({ profile: result.rows[0] });
  } catch (err) {
    console.error("[quota] PUT /profiles/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/profiles/:id", async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql.query(
      `DELETE FROM quota_profiles WHERE id = $1 AND app_id = $2 RETURNING id`,
      [req.params.id, req.appId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }
    invalidateQuotaCache(req.appId);
    return res.json({ deleted: true });
  } catch (err) {
    console.error("[quota] DELETE /profiles/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Profile Limits ───────────────────────────────────────────────────────────

router.post("/profiles/:id/limits", async (req, res) => {
  try {
    const { channel, limit_count, period } = req.body;

    if (!channel || limit_count === undefined || !period) {
      return res.status(400).json({ error: "channel, limit_count, and period are required" });
    }
    if (!["daily", "monthly"].includes(period)) {
      return res.status(400).json({ error: "period must be 'daily' or 'monthly'" });
    }
    if (typeof limit_count !== "number" || limit_count < 0) {
      return res.status(400).json({ error: "limit_count must be a non-negative integer" });
    }

    const sql = getDb();
    // Verify profile belongs to this app
    const profile = await sql.query(
      `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [req.params.id, req.appId]
    );
    if (profile.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const result = await sql.query(
      `INSERT INTO quota_profile_limits (profile_id, channel, limit_count, period)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (profile_id, channel) DO UPDATE SET limit_count = $3, period = $4
       RETURNING *`,
      [req.params.id, channel, limit_count, period]
    );

    return res.status(201).json({ limit: result.rows[0] });
  } catch (err) {
    console.error("[quota] POST /profiles/:id/limits error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/profiles/:id/limits/:channel", async (req, res) => {
  try {
    const sql = getDb();
    const profile = await sql.query(
      `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [req.params.id, req.appId]
    );
    if (profile.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    await sql.query(
      `DELETE FROM quota_profile_limits WHERE profile_id = $1 AND channel = $2`,
      [req.params.id, req.params.channel]
    );

    return res.json({ deleted: true });
  } catch (err) {
    console.error("[quota] DELETE /profiles/:id/limits/:channel error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Owner Quota ──────────────────────────────────────────────────────────────

router.get("/owners", async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql.query(
      `SELECT oq.owner_id, oq.profile_id, oq.overrides, oq.updated_at,
              qp.name AS profile_name, qp.is_default
       FROM owner_quota oq
       LEFT JOIN quota_profiles qp ON qp.id = oq.profile_id
       WHERE oq.app_id = $1
       ORDER BY oq.owner_id`,
      [req.appId]
    );
    return res.json({ owners: result.rows });
  } catch (err) {
    console.error("[quota] GET /owners error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/owners/:ownerId", async (req, res) => {
  try {
    const { profile_id, overrides } = req.body;
    const { ownerId } = req.params;

    if (!ownerId) {
      return res.status(400).json({ error: "ownerId is required" });
    }

    const sql = getDb();

    // Validate profile_id belongs to this app
    if (profile_id) {
      const prof = await sql.query(
        `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
        [profile_id, req.appId]
      );
      if (prof.rows.length === 0) {
        return res.status(400).json({ error: "profile_id does not belong to this app" });
      }
    }

    const result = await sql.query(
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (app_id, owner_id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id,
             overrides  = EXCLUDED.overrides,
             updated_at = now()
       RETURNING *`,
      [req.appId, ownerId, profile_id || null, JSON.stringify(overrides || {})]
    );

    invalidateQuotaCache(req.appId);
    return res.json({ owner: result.rows[0] });
  } catch (err) {
    console.error("[quota] PUT /owners/:ownerId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/owners/:ownerId", async (req, res) => {
  try {
    const sql = getDb();
    await sql.query(
      `DELETE FROM owner_quota WHERE app_id = $1 AND owner_id = $2`,
      [req.appId, req.params.ownerId]
    );
    invalidateQuotaCache(req.appId);
    return res.json({ deleted: true });
  } catch (err) {
    console.error("[quota] DELETE /owners/:ownerId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Threshold events ─────────────────────────────────────────────────────────

router.get("/thresholds", async (req, res) => {
  try {
    const sql = getDb();
    const { owner_id, channel, limit: limitStr = "50" } = req.query;
    const limit = Math.min(200, Math.max(1, parseInt(limitStr, 10) || 50));

    const params = [req.appId, limit];
    const where = ["app_id = $1"];

    if (owner_id) {
      params.push(owner_id);
      where.push(`owner_id = $${params.length}`);
    }
    if (channel) {
      params.push(channel);
      where.push(`channel = $${params.length}`);
    }

    const result = await sql.query(
      `SELECT * FROM quota_threshold_events
       WHERE ${where.join(" AND ")}
       ORDER BY fired_at DESC
       LIMIT $2`,
      params
    );

    return res.json({ threshold_events: result.rows });
  } catch (err) {
    console.error("[quota] GET /thresholds error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
