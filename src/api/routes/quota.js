"use strict";

/**
 * Quota management API — CRUD for quota profiles, limits, and owner overrides.
 *
 * Routes:
 *   GET    /quota/usage                        — current period usage summary for the app
 *   GET    /quota/profiles                     — list profiles; includes owner_count per profile
 *   POST   /quota/profiles                     — create a profile
 *   PUT    /quota/profiles/:id                 — update a profile (rename, set default)
 *   DELETE /quota/profiles/:id                 — delete a profile (409 if owners assigned; refuse default)
 *                                                ?reassign_to=<profileId> to reassign owners first
 *   POST   /quota/profiles/:id/limits          — upsert a channel limit
 *   DELETE /quota/profiles/:id/limits/:channel — remove a channel limit
 *   GET    /quota/owners                       — list owner_quota rows (search, pagination, filter, usage summary)
 *   GET    /quota/owners/:ownerId              — owner detail with effective limits per channel
 *   PUT    /quota/owners/:ownerId              — upsert owner quota (profile + overrides + label)
 *   DELETE /quota/owners/:ownerId              — remove owner quota row
 *   POST   /quota/owners/bulk                  — bulk assign up to 500 owners in one transaction
 *   GET    /quota/owners/:ownerId/branches     — per-branch usage for the current period
 *   GET    /quota/thresholds                   — recent threshold events
 *   GET    /quota/webhooks/deliveries          — webhook delivery history
 *   POST   /quota/webhooks/deliveries/:id/retry — dashboard retry
 */

const { Router } = require("express");
const { getDb } = require("../../db");
const { invalidateQuotaCache, getPeriodStart } = require("../../utils/quota");

const router = Router();

const KNOWN_CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];

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

/**
 * GET /quota/profiles
 * Returns all profiles for this app including:
 *   - limits[]
 *   - owner_count: number of owner_quota rows pointing to this profile
 */
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
              ) AS limits,
              COUNT(DISTINCT oq.owner_id)::int AS owner_count
       FROM quota_profiles p
       LEFT JOIN quota_profile_limits l ON l.profile_id = p.id
       LEFT JOIN owner_quota oq ON oq.profile_id = p.id AND oq.app_id = p.app_id
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

/**
 * DELETE /quota/profiles/:id
 * Guards:
 *   1. Cannot delete the default profile.
 *   2. Cannot delete a profile with assigned owners unless ?reassign_to=<profileId> is given.
 */
router.delete("/profiles/:id", async (req, res) => {
  try {
    const sql = getDb();
    const { reassign_to } = req.query;

    // Fetch profile + owner count in parallel
    const [profileRes, ownerRes] = await Promise.all([
      sql.query(
        `SELECT id, is_default FROM quota_profiles WHERE id = $1 AND app_id = $2`,
        [req.params.id, req.appId]
      ),
      sql.query(
        `SELECT COUNT(*)::int AS cnt FROM owner_quota WHERE profile_id = $1 AND app_id = $2`,
        [req.params.id, req.appId]
      ),
    ]);

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profile = profileRes.rows[0];
    const ownerCount = ownerRes.rows[0].cnt;

    // Guard: refuse deletion of the default profile
    if (profile.is_default) {
      return res.status(409).json({
        error: "Cannot delete the default profile. Assign another profile as default first.",
        code: "DEFAULT_PROFILE",
      });
    }

    // Guard: refuse deletion when owners are assigned unless reassign_to is given
    if (ownerCount > 0) {
      if (!reassign_to) {
        return res.status(409).json({
          error: `This profile has ${ownerCount} owner(s) assigned. Provide ?reassign_to=<profileId> to reassign them before deletion.`,
          code: "OWNERS_ASSIGNED",
          owner_count: ownerCount,
        });
      }

      // Validate reassign target
      const targetRes = await sql.query(
        `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
        [reassign_to, req.appId]
      );
      if (targetRes.rows.length === 0) {
        return res.status(400).json({ error: "reassign_to profile not found for this app" });
      }

      // Reassign all owners to the new profile
      await sql.query(
        `UPDATE owner_quota SET profile_id = $1, updated_at = now()
         WHERE profile_id = $2 AND app_id = $3`,
        [reassign_to, req.params.id, req.appId]
      );
    }

    await sql.query(
      `DELETE FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [req.params.id, req.appId]
    );

    invalidateQuotaCache(req.appId);
    return res.json({ deleted: true, reassigned: ownerCount > 0 ? ownerCount : 0 });
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
    if (!KNOWN_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `channel must be one of: ${KNOWN_CHANNELS.join(", ")}` });
    }
    if (!["daily", "monthly"].includes(period)) {
      return res.status(400).json({ error: "period must be 'daily' or 'monthly'" });
    }
    if (typeof limit_count !== "number" || limit_count < 0 || !Number.isInteger(limit_count)) {
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

/**
 * GET /quota/owners
 * Query params:
 *   q          — search on owner_id or label (case-insensitive ILIKE)
 *   profile_id — filter by assigned profile
 *   page       — page number (default 1)
 *   limit      — per page (default 20, max 100)
 *
 * Each row includes: owner_id, label, profile {id, name, is_default}, override_count,
 * highest utilization percentage across limited channels for the current period.
 */
router.get("/owners", async (req, res) => {
  try {
    const sql = getDb();
    const { q, profile_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const params = [req.appId];
    const where = ["oq.app_id = $1"];

    if (q) {
      params.push(`%${q}%`);
      where.push(`(oq.owner_id ILIKE $${params.length} OR oq.label ILIKE $${params.length})`);
    }
    if (profile_id) {
      params.push(profile_id);
      where.push(`oq.profile_id = $${params.length}`);
    }

    const whereClause = where.join(" AND ");

    // Run count and data queries in parallel
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, dataRes] = await Promise.all([
      sql.query(
        `SELECT COUNT(*)::int AS total FROM owner_quota oq WHERE ${whereClause}`,
        countParams
      ),
      sql.query(
        `SELECT
           oq.owner_id,
           oq.label,
           oq.profile_id,
           oq.overrides,
           oq.updated_at,
           qp.name AS profile_name,
           qp.is_default AS profile_is_default,
           -- highest utilization: MAX(used / limit_count) across limited channels
           (
             SELECT ROUND(MAX(
               CASE WHEN qpl2.limit_count > 0
                    THEN (COALESCE(qu2.used, 0)::numeric * 100) / qpl2.limit_count
                    ELSE 0 END
             ))::int
             FROM quota_profile_limits qpl2
             LEFT JOIN quota_usage qu2
               ON qu2.app_id = oq.app_id
              AND qu2.owner_id = oq.owner_id
              AND qu2.channel = qpl2.channel
              AND qu2.period_start = (
                CASE qpl2.period
                  WHEN 'monthly' THEN date_trunc('month', CURRENT_DATE)::date
                  ELSE CURRENT_DATE
                END
              )
             WHERE qpl2.profile_id = oq.profile_id
           ) AS highest_utilization
         FROM owner_quota oq
         LEFT JOIN quota_profiles qp ON qp.id = oq.profile_id
         WHERE ${whereClause}
         ORDER BY oq.owner_id
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
    ]);

    const total = countRes.rows[0].total;

    return res.json({
      owners: dataRes.rows.map((row) => {
        const overrides = row.overrides || {};
        return {
          owner_id: row.owner_id,
          label: row.label || null,
          profile: row.profile_id
            ? { id: row.profile_id, name: row.profile_name, is_default: row.profile_is_default }
            : null,
          overrides,
          override_count: Object.keys(overrides).length,
          highest_utilization: row.highest_utilization || 0,
          updated_at: row.updated_at,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[quota] GET /owners error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /quota/owners/:ownerId
 * Returns owner detail with effective limits per channel including:
 *   - source: 'override' | 'profile' | 'default_profile' | 'none'
 *   - used, reserved, remaining, percentage, status (healthy | warning | exceeded)
 *   - period, period_start, period_end
 */
router.get("/owners/:ownerId", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId } = req.params;

    // Fetch owner row + profile in parallel with default profile
    const [ownerRes, defaultProfileRes] = await Promise.all([
      sql.query(
        `SELECT oq.owner_id, oq.label, oq.profile_id, oq.overrides, oq.updated_at,
                qp.name AS profile_name, qp.is_default AS profile_is_default,
                COALESCE(
                  json_agg(json_build_object(
                    'channel', l.channel, 'limit_count', l.limit_count, 'period', l.period
                  )) FILTER (WHERE l.channel IS NOT NULL),
                  '[]'
                ) AS profile_limits
         FROM owner_quota oq
         LEFT JOIN quota_profiles qp ON qp.id = oq.profile_id
         LEFT JOIN quota_profile_limits l ON l.profile_id = oq.profile_id
         WHERE oq.app_id = $1 AND oq.owner_id = $2
         GROUP BY oq.owner_id, oq.label, oq.profile_id, oq.overrides, oq.updated_at,
                  qp.name, qp.is_default`,
        [req.appId, ownerId]
      ),
      sql.query(
        `SELECT p.id, p.name,
                COALESCE(
                  json_agg(json_build_object(
                    'channel', l.channel, 'limit_count', l.limit_count, 'period', l.period
                  )) FILTER (WHERE l.channel IS NOT NULL),
                  '[]'
                ) AS limits
         FROM quota_profiles p
         LEFT JOIN quota_profile_limits l ON l.profile_id = p.id
         WHERE p.app_id = $1 AND p.is_default = true
         GROUP BY p.id, p.name`,
        [req.appId]
      ),
    ]);

    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: "Owner not found" });
    }

    const owner = ownerRes.rows[0];
    const defaultProfile = defaultProfileRes.rows[0] || null;
    const overrides = owner.overrides || {};
    const profileLimits = owner.profile_limits || [];
    const defaultLimits = defaultProfile?.limits || [];

    // Build effective limits for all known channels
    const effectiveLimits = await Promise.all(
      KNOWN_CHANNELS.map(async (channel) => {
        let source = "none";
        let limitCount = null;
        let period = null;

        // Check override
        const ov = overrides[channel];
        if (ov && typeof ov.limit === "number") {
          source = "override";
          limitCount = ov.limit;
          period = ov.period || "monthly";
        } else {
          // Check profile limit
          const pl = profileLimits.find((l) => l.channel === channel);
          if (pl) {
            source = "profile";
            limitCount = pl.limit_count;
            period = pl.period;
          } else {
            // Check default profile
            const dl = defaultLimits.find((l) => l.channel === channel);
            if (dl) {
              source = "default_profile";
              limitCount = dl.limit_count;
              period = dl.period;
            }
          }
        }

        if (limitCount === null) {
          // Fetch sent_count for unlimited channel (from quota_usage if exists)
          const usageRes = await sql.query(
            `SELECT COALESCE(used, 0) AS used, COALESCE(reserved, 0) AS reserved, period_start
             FROM quota_usage
             WHERE app_id = $1 AND owner_id = $2 AND channel = $3
             ORDER BY period_start DESC LIMIT 1`,
            [req.appId, ownerId, channel]
          );
          const u = usageRes.rows[0];
          return {
            channel,
            source: "none",
            limit: null,
            period: null,
            period_start: u?.period_start || null,
            period_end: null,
            used: u ? Number(u.used) : 0,
            reserved: u ? Number(u.reserved) : 0,
            remaining: null,
            percentage: null,
            status: "healthy",
          };
        }

        // Compute period dates
        const tz = await _getQuotaTimezoneStatic(sql);
        const periodStart = getPeriodStart(period, tz);
        const periodEnd = getPeriodEnd(period, periodStart);

        // Fetch usage
        const usageRes = await sql.query(
          `SELECT COALESCE(used, 0) AS used, COALESCE(reserved, 0) AS reserved
           FROM quota_usage
           WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
          [req.appId, ownerId, channel, periodStart]
        );
        const u = usageRes.rows[0] || { used: 0, reserved: 0 };
        const used = Number(u.used);
        const reserved = Number(u.reserved);
        const remaining = Math.max(0, limitCount - used - reserved);
        const percentage = limitCount > 0 ? Math.round((used / limitCount) * 100) : 0;
        const status = percentage >= 100 ? "exceeded" : percentage >= 80 ? "warning" : "healthy";

        return {
          channel,
          source,
          limit: limitCount,
          period,
          period_start: periodStart,
          period_end: periodEnd,
          used,
          reserved,
          remaining,
          percentage,
          status,
        };
      })
    );

    return res.json({
      owner: {
        owner_id: owner.owner_id,
        label: owner.label || null,
        profile: owner.profile_id
          ? { id: owner.profile_id, name: owner.profile_name, is_default: owner.profile_is_default }
          : null,
        overrides,
        updated_at: owner.updated_at,
      },
      effective_limits: effectiveLimits,
    });
  } catch (err) {
    console.error("[quota] GET /owners/:ownerId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /quota/owners/:ownerId
 * Body: { profile_id?, overrides?, label? }
 * - Validates profile_id belongs to this app
 * - Validates override channels are known
 * - Accepts optional label
 * - Returns effective limits
 */
router.put("/owners/:ownerId", async (req, res) => {
  try {
    const { profile_id, overrides, label } = req.body;
    const { ownerId } = req.params;

    if (!ownerId) {
      return res.status(400).json({ error: "ownerId is required" });
    }

    // Validate overrides structure
    if (overrides !== undefined) {
      if (typeof overrides !== "object" || Array.isArray(overrides)) {
        return res.status(400).json({ error: "overrides must be an object" });
      }
      for (const [ch, cfg] of Object.entries(overrides)) {
        if (!KNOWN_CHANNELS.includes(ch)) {
          return res.status(400).json({ error: `Unknown channel in overrides: ${ch}. Known channels: ${KNOWN_CHANNELS.join(", ")}` });
        }
        if (typeof cfg.limit !== "number" || cfg.limit < 0 || !Number.isInteger(cfg.limit)) {
          return res.status(400).json({ error: `overrides.${ch}.limit must be a non-negative integer` });
        }
        if (cfg.period && !["daily", "monthly"].includes(cfg.period)) {
          return res.status(400).json({ error: `overrides.${ch}.period must be 'daily' or 'monthly'` });
        }
      }
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
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, label, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (app_id, owner_id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id,
             overrides  = EXCLUDED.overrides,
             label      = EXCLUDED.label,
             updated_at = now()
       RETURNING *`,
      [req.appId, ownerId, profile_id || null, JSON.stringify(overrides || {}), label || null]
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

/**
 * POST /quota/owners/bulk
 * Body: { owner_ids: string[], profile_id: string, overrides?: object, label?: string }
 * Assigns up to 500 owners in one transaction.
 * Returns per-owner success/failure.
 */
router.post("/owners/bulk", async (req, res) => {
  try {
    const { owner_ids, profile_id, overrides, label } = req.body;

    if (!Array.isArray(owner_ids) || owner_ids.length === 0) {
      return res.status(400).json({ error: "owner_ids must be a non-empty array" });
    }
    if (owner_ids.length > 500) {
      return res.status(400).json({ error: "Maximum 500 owner_ids per bulk call" });
    }
    if (!profile_id) {
      return res.status(400).json({ error: "profile_id is required" });
    }

    // Validate overrides
    if (overrides !== undefined) {
      if (typeof overrides !== "object" || Array.isArray(overrides)) {
        return res.status(400).json({ error: "overrides must be an object" });
      }
      for (const [ch, cfg] of Object.entries(overrides)) {
        if (!KNOWN_CHANNELS.includes(ch)) {
          return res.status(400).json({ error: `Unknown channel in overrides: ${ch}` });
        }
        if (typeof cfg.limit !== "number" || cfg.limit < 0 || !Number.isInteger(cfg.limit)) {
          return res.status(400).json({ error: `overrides.${ch}.limit must be a non-negative integer` });
        }
      }
    }

    const sql = getDb();

    // Validate profile_id
    const profRes = await sql.query(
      `SELECT id FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [profile_id, req.appId]
    );
    if (profRes.rows.length === 0) {
      return res.status(400).json({ error: "profile_id does not belong to this app" });
    }

    const overridesJson = JSON.stringify(overrides || {});
    const results = [];

    const client = await sql.raw.connect();
    try {
      await client.query("BEGIN");

      for (const ownerId of owner_ids) {
        if (!ownerId || typeof ownerId !== "string" || !ownerId.trim()) {
          results.push({ owner_id: ownerId, success: false, error: "Invalid owner_id" });
          continue;
        }
        try {
          await client.query(
            `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, label, updated_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (app_id, owner_id) DO UPDATE
               SET profile_id = EXCLUDED.profile_id,
                   overrides  = EXCLUDED.overrides,
                   label      = COALESCE(EXCLUDED.label, owner_quota.label),
                   updated_at = now()`,
            [req.appId, ownerId.trim(), profile_id, overridesJson, label || null]
          );
          results.push({ owner_id: ownerId.trim(), success: true });
        } catch (rowErr) {
          results.push({ owner_id: ownerId, success: false, error: rowErr.message });
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    invalidateQuotaCache(req.appId);

    const successCount = results.filter((r) => r.success).length;
    return res.json({
      results,
      summary: {
        total: owner_ids.length,
        succeeded: successCount,
        failed: owner_ids.length - successCount,
      },
    });
  } catch (err) {
    console.error("[quota] POST /owners/bulk error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /quota/owners/:ownerId/branches
 * Per-branch (entity_id) usage per channel for the current period,
 * derived from quota_reservations.
 */
router.get("/owners/:ownerId/branches", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId } = req.params;

    // Verify owner exists in this app
    const ownerCheck = await sql.query(
      `SELECT owner_id FROM owner_quota WHERE app_id = $1 AND owner_id = $2`,
      [req.appId, ownerId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: "Owner not found" });
    }

    const result = await sql.query(
      `SELECT
         qr.entity_id,
         qr.channel,
         qr.period_start,
         SUM(CASE WHEN qr.status = 'consumed' THEN qr.units ELSE 0 END)::int AS used,
         SUM(CASE WHEN qr.status = 'reserved' THEN qr.units ELSE 0 END)::int AS reserved,
         COUNT(DISTINCT qr.notification_id)::int AS notification_count
       FROM quota_reservations qr
       WHERE qr.app_id = $1
         AND qr.owner_id = $2
         AND qr.period_start >= date_trunc('month', CURRENT_DATE)::date
       GROUP BY qr.entity_id, qr.channel, qr.period_start
       ORDER BY qr.entity_id, qr.channel`,
      [req.appId, ownerId]
    );

    // Group by entity_id
    const byBranch = {};
    for (const row of result.rows) {
      const key = row.entity_id || "(no entity)";
      if (!byBranch[key]) byBranch[key] = [];
      byBranch[key].push({
        channel: row.channel,
        period_start: row.period_start,
        used: row.used,
        reserved: row.reserved,
        notification_count: row.notification_count,
      });
    }

    return res.json({
      owner_id: ownerId,
      branches: Object.entries(byBranch).map(([entity_id, channels]) => ({
        entity_id,
        channels,
      })),
    });
  } catch (err) {
    console.error("[quota] GET /owners/:ownerId/branches error:", err);
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get quota timezone from app_settings (cached inline).
 * This is a simplified version to avoid circular imports.
 */
let _tz = null;
let _tzExp = 0;
async function _getQuotaTimezoneStatic(sql) {
  if (_tz && Date.now() < _tzExp) return _tz;
  const r = await sql.query(`SELECT value FROM app_settings WHERE key = 'quota_timezone' LIMIT 1`);
  _tz = r.rows[0]?.value || "Asia/Kolkata";
  _tzExp = Date.now() + 300_000;
  return _tz;
}

/**
 * Compute period end date string from period and period_start.
 */
function getPeriodEnd(period, periodStart) {
  const d = new Date(periodStart);
  if (period === "monthly") {
    // Last day of the month
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return end.toISOString().split("T")[0];
  }
  return periodStart; // daily period ends on same day
}

module.exports = router;
