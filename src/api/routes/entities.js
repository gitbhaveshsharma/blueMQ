"use strict";

/**
 * Entity / Owner-scoped read APIs for customer apps.
 *
 * All endpoints are scoped to the requesting app's API key.
 * Another app's key CANNOT access another app's owner data.
 * owner_id matches parent_entity_id (or entity_id fallback) on notifications.
 *
 * Routes:
 *   GET /entities/:ownerId/quota
 *     Effective limits per channel + optional threshold events.
 *     ?include=thresholds to include recent threshold events.
 *     Unlimited channels return sent_count for the current period.
 *
 *   GET /entities/:ownerId/stats
 *     Aggregated notification stats.
 *     ?from=YYYY-MM-DD &to=YYYY-MM-DD &channel= &type= &entity_id= &group_by=day|channel|type|branch
 *
 *   GET /entities/:ownerId/notifications
 *     Paginated (cursor) list of whitelisted notification fields.
 *     ?from= &to= &channel= &status= &type= &entity_id= &cursor= &limit= (default 50, max 200)
 *
 *   GET /entities/:ownerId/notifications/:id
 *     Single notification detail (whitelisted fields only).
 *
 * SECURITY:
 *   - NEVER returns: data JSONB, email, phone, push tokens, provider credentials.
 *   - Whitelisted returned fields are enumerated explicitly in each query.
 *   - owner_id isolation: queries always include app_id = req.appId AND
 *     (parent_entity_id = ownerId OR (parent_entity_id IS NULL AND entity_id = ownerId)).
 */

const { Router } = require("express");
const { getDb } = require("../../db");
const { getPeriodStart } = require("../../utils/quota");

const router = Router();

const KNOWN_CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];

// ─── Whitelisted notification fields ─────────────────────────────────────────

const NOTIFICATION_FIELDS = `
  n.id,
  n.type,
  n.title,
  n.message,
  n.action_url,
  n.status,
  n.entity_id,
  n.parent_entity_id,
  n.external_user_id,
  n.created_at
`;

// ─── Owner scope SQL fragment ─────────────────────────────────────────────────

/**
 * Returns SQL WHERE clause that scopes to the given owner.
 * Owner is parent_entity_id if set, else entity_id.
 */
function ownerScope(ownerId, params, tableAlias = "n") {
  params.push(ownerId);
  const p = params.length;
  return `(${tableAlias}.parent_entity_id = $${p} OR (${tableAlias}.parent_entity_id IS NULL AND ${tableAlias}.entity_id = $${p}))`;
}

// ─── Timezone helper ──────────────────────────────────────────────────────────

let _tz = null;
let _tzExp = 0;
async function getQuotaTimezone(sql) {
  if (_tz && Date.now() < _tzExp) return _tz;
  const r = await sql.query(`SELECT value FROM app_settings WHERE key = 'quota_timezone' LIMIT 1`);
  _tz = r.rows[0]?.value || "Asia/Kolkata";
  _tzExp = Date.now() + 300_000;
  return _tz;
}

function getPeriodEnd(period, periodStart) {
  const d = new Date(periodStart);
  if (period === "monthly") {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return end.toISOString().split("T")[0];
  }
  return periodStart;
}

// ─── GET /entities/:ownerId/quota ─────────────────────────────────────────────

/**
 * Effective limits per channel for an owner.
 * Same payload shape as GET /quota/owners/:ownerId.
 * Optional ?include=thresholds adds recent threshold events.
 * Unlimited channels return sent_count for the current period.
 */
router.get("/:ownerId/quota", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId } = req.params;
    const include = (req.query.include || "").split(",").map((s) => s.trim());
    const includeThresholds = include.includes("thresholds");

    // Fetch owner row + default profile in parallel
    const [ownerRes, defaultProfileRes] = await Promise.all([
      sql.query(
        `SELECT oq.owner_id, oq.label, oq.profile_id, oq.overrides,
                qp.name AS profile_name,
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
         GROUP BY oq.owner_id, oq.label, oq.profile_id, oq.overrides, qp.name`,
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

    const owner = ownerRes.rows[0];
    const defaultProfile = defaultProfileRes.rows[0] || null;
    const overrides = owner?.overrides || {};
    const profileLimits = owner?.profile_limits || [];
    const defaultLimits = defaultProfile?.limits || [];

    const tz = await getQuotaTimezone(sql);

    // Build effective limits — run all channel queries in parallel
    const effectiveLimits = await Promise.all(
      KNOWN_CHANNELS.map(async (channel) => {
        let source = "none";
        let limitCount = null;
        let period = null;

        const ov = overrides[channel];
        if (ov && typeof ov.limit === "number") {
          source = "override";
          limitCount = ov.limit;
          period = ov.period || "monthly";
        } else {
          const pl = profileLimits.find((l) => l.channel === channel);
          if (pl) {
            source = "profile";
            limitCount = pl.limit_count;
            period = pl.period;
          } else {
            const dl = defaultLimits.find((l) => l.channel === channel);
            if (dl) {
              source = "default_profile";
              limitCount = dl.limit_count;
              period = dl.period;
            }
          }
        }

        if (limitCount === null) {
          // Unlimited: return sent_count from notification_logs for current period
          const sentRes = await sql.query(
            `SELECT COUNT(*)::int AS sent_count
             FROM notification_logs nl
             JOIN notifications n ON n.id = nl.notification_id
             WHERE n.app_id = $1
               AND nl.channel = $2
               AND nl.status = 'sent'
               AND (n.parent_entity_id = $3 OR (n.parent_entity_id IS NULL AND n.entity_id = $3))
               AND nl.sent_at >= date_trunc('month', CURRENT_DATE)`,
            [req.appId, channel, ownerId]
          );
          return {
            channel,
            source: "none",
            limit: null,
            period: null,
            period_start: null,
            period_end: null,
            used: null,
            reserved: null,
            remaining: null,
            percentage: null,
            status: "healthy",
            sent_count: sentRes.rows[0]?.sent_count || 0,
          };
        }

        const periodStart = getPeriodStart(period, tz);
        const periodEnd = getPeriodEnd(period, periodStart);

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

    const response = {
      owner: owner
        ? {
            owner_id: owner.owner_id,
            label: owner.label || null,
            profile: owner.profile_id
              ? { id: owner.profile_id, name: owner.profile_name }
              : null,
          }
        : { owner_id: ownerId, label: null, profile: null },
      effective_limits: effectiveLimits,
    };

    // Optionally include recent threshold events
    if (includeThresholds) {
      const tRes = await sql.query(
        `SELECT channel, threshold, period_start, fired_at
         FROM quota_threshold_events
         WHERE app_id = $1 AND owner_id = $2
         ORDER BY fired_at DESC
         LIMIT 20`,
        [req.appId, ownerId]
      );
      response.threshold_events = tRes.rows;
    }

    return res.json(response);
  } catch (err) {
    console.error("[entities] GET /:ownerId/quota error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /entities/:ownerId/stats ─────────────────────────────────────────────

/**
 * Aggregated notification delivery stats for an owner.
 * ?from=YYYY-MM-DD &to=YYYY-MM-DD &channel= &type= &entity_id=
 * &group_by=day|channel|type|branch (default: day)
 */
router.get("/:ownerId/stats", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId } = req.params;
    const { from, to, channel, type, entity_id, group_by = "day" } = req.query;

    const validGroupBy = ["day", "channel", "type", "branch"];
    if (!validGroupBy.includes(group_by)) {
      return res.status(400).json({ error: `group_by must be one of: ${validGroupBy.join(", ")}` });
    }

    const params = [req.appId];
    const where = ["n.app_id = $1"];

    // Owner scope
    params.push(ownerId);
    where.push(`(n.parent_entity_id = $${params.length} OR (n.parent_entity_id IS NULL AND n.entity_id = $${params.length}))`);

    if (channel) {
      if (!KNOWN_CHANNELS.includes(channel)) {
        return res.status(400).json({ error: `Invalid channel: ${channel}` });
      }
      params.push(channel);
      where.push(`nl.channel = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`n.type = $${params.length}`);
    }
    if (entity_id) {
      params.push(entity_id);
      where.push(`n.entity_id = $${params.length}`);
    }
    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: "from must be YYYY-MM-DD" });
      }
      params.push(from);
      where.push(`nl.sent_at >= $${params.length}::date`);
    }
    if (to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: "to must be YYYY-MM-DD" });
      }
      params.push(to);
      where.push(`nl.sent_at < ($${params.length}::date + interval '1 day')`);
    }

    const whereClause = where.join(" AND ");

    let selectClause, groupClause, orderClause;

    switch (group_by) {
      case "day":
        selectClause = `to_char(date_trunc('day', nl.sent_at), 'YYYY-MM-DD') AS day`;
        groupClause = `1`;
        orderClause = `1 ASC`;
        break;
      case "channel":
        selectClause = `nl.channel`;
        groupClause = `nl.channel`;
        orderClause = `nl.channel`;
        break;
      case "type":
        selectClause = `n.type`;
        groupClause = `n.type`;
        orderClause = `n.type`;
        break;
      case "branch":
        selectClause = `COALESCE(n.entity_id, '(none)') AS entity_id`;
        groupClause = `n.entity_id`;
        orderClause = `n.entity_id`;
        break;
    }

    const result = await sql.query(
      `SELECT
         ${selectClause},
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE nl.status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE nl.status IN ('failed', 'permanently_failed'))::int AS failed,
         COUNT(*) FILTER (WHERE nl.status = 'pending')::int AS pending,
         COUNT(DISTINCT nl.notification_id)::int AS notifications
       FROM notification_logs nl
       JOIN notifications n ON n.id = nl.notification_id
       WHERE ${whereClause}
       GROUP BY ${groupClause}
       ORDER BY ${orderClause}`,
      params
    );

    return res.json({ group_by, stats: result.rows });
  } catch (err) {
    console.error("[entities] GET /:ownerId/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /entities/:ownerId/notifications ─────────────────────────────────────

/**
 * Cursor-paginated list of notifications for an owner.
 * Returns whitelisted fields only (no data JSONB, no PII/tokens).
 * ?from= &to= &channel= &status= &type= &entity_id= &cursor= &limit= (default 50, max 200)
 */
router.get("/:ownerId/notifications", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId } = req.params;
    const { from, to, channel, status, type, entity_id, cursor } = req.query;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const params = [req.appId];
    const where = ["n.app_id = $1"];

    // Owner scope
    params.push(ownerId);
    where.push(`(n.parent_entity_id = $${params.length} OR (n.parent_entity_id IS NULL AND n.entity_id = $${params.length}))`);

    if (channel) {
      params.push(channel);
      where.push(`nl.channel = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`nl.status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`n.type = $${params.length}`);
    }
    if (entity_id) {
      params.push(entity_id);
      where.push(`n.entity_id = $${params.length}`);
    }
    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: "from must be YYYY-MM-DD" });
      }
      params.push(from);
      where.push(`n.created_at >= $${params.length}::date`);
    }
    if (to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: "to must be YYYY-MM-DD" });
      }
      params.push(to);
      where.push(`n.created_at < ($${params.length}::date + interval '1 day')`);
    }

    // Cursor pagination: cursor is a base64-encoded ISO timestamp
    if (cursor) {
      try {
        const cursorTs = Buffer.from(cursor, "base64").toString("utf8");
        params.push(cursorTs);
        where.push(`n.created_at < $${params.length}`);
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
    }

    // Determine if we're joining notification_logs (needed for channel/status filters)
    const needsLogJoin = channel || status;
    const fromClause = needsLogJoin
      ? `FROM notifications n JOIN notification_logs nl ON nl.notification_id = n.id`
      : `FROM notifications n`;

    // For whitelisted fields without log join, we don't expose nl columns
    const selectFields = needsLogJoin
      ? `${NOTIFICATION_FIELDS}, nl.channel, nl.status AS delivery_status`
      : NOTIFICATION_FIELDS;

    params.push(limit + 1); // fetch +1 to detect next page
    const dataRes = await sql.query(
      `SELECT ${selectFields}
       ${fromClause}
       WHERE ${where.join(" AND ")}
       ORDER BY n.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    const rows = dataRes.rows;
    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;

    let nextCursor = null;
    if (hasNext && items.length > 0) {
      const lastTs = items[items.length - 1].created_at;
      nextCursor = Buffer.from(new Date(lastTs).toISOString()).toString("base64");
    }

    return res.json({
      notifications: items,
      pagination: {
        limit,
        has_next: hasNext,
        next_cursor: nextCursor,
      },
    });
  } catch (err) {
    console.error("[entities] GET /:ownerId/notifications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /entities/:ownerId/notifications/:id ─────────────────────────────────

/**
 * Single notification detail for an owner.
 * Whitelisted fields only — no data JSONB, no PII.
 */
router.get("/:ownerId/notifications/:id", async (req, res) => {
  try {
    const sql = getDb();
    const { ownerId, id } = req.params;

    const result = await sql.query(
      `SELECT ${NOTIFICATION_FIELDS}
       FROM notifications n
       WHERE n.app_id = $1
         AND n.id = $2
         AND (n.parent_entity_id = $3 OR (n.parent_entity_id IS NULL AND n.entity_id = $3))`,
      [req.appId, id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    // Fetch delivery channel statuses (whitelisted fields only — no provider creds)
    const logsRes = await sql.query(
      `SELECT channel, status, attempt_number, sent_at
       FROM notification_logs
       WHERE notification_id = $1
       ORDER BY sent_at ASC`,
      [id]
    );

    return res.json({
      notification: result.rows[0],
      delivery_logs: logsRes.rows,
    });
  } catch (err) {
    console.error("[entities] GET /:ownerId/notifications/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
