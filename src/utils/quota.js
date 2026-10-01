"use strict";

/**
 * Quota utility — reserve, settle, threshold checking, and stale cleanup.
 *
 * Design rules (from spec):
 *  - quota_owner_id = parent_entity_id if present, else entity_id.
 *  - All counters are keyed by (app_id, owner_id, channel, period_start).
 *  - Reserve uses an atomic INSERT … ON CONFLICT … DO UPDATE … WHERE clause.
 *    Caller must pre-check units <= limit before calling to handle the first-
 *    insert case (WHERE does not apply on INSERT, only on UPDATE).
 *  - Settle is always in the SAME transaction that writes notification_logs.
 *  - "App has quotas" check is cached for 60 seconds per app.
 */

const { getDb } = require("../db");

// ─── In-memory cache: "does this app have any quotas configured?" ────────────

/** @type {Map<string, { hasQuotas: boolean, expiresAt: number }>} */
const _quotaCache = new Map();
const QUOTA_CACHE_TTL_MS = 60_000;

/**
 * Returns true if the app has any quota profiles or owner_quota rows.
 * Cached for 60 s to avoid per-request DB hits.
 *
 * @param {import('../db').SqlClient} sql
 * @param {string} appId
 */
async function appHasQuotas(sql, appId) {
  const cached = _quotaCache.get(appId);
  if (cached && Date.now() < cached.expiresAt) return cached.hasQuotas;

  const profileRes = await sql.query(
    `SELECT 1 FROM quota_profiles WHERE app_id = $1 LIMIT 1`,
    [appId]
  );
  let hasQuotas = profileRes.rows.length > 0;

  if (!hasQuotas) {
    const ownerRes = await sql.query(
      `SELECT 1 FROM owner_quota WHERE app_id = $1 LIMIT 1`,
      [appId]
    );
    hasQuotas = ownerRes.rows.length > 0;
  }

  _quotaCache.set(appId, { hasQuotas, expiresAt: Date.now() + QUOTA_CACHE_TTL_MS });
  return hasQuotas;
}

/**
 * Invalidate the quota cache for an app.
 * Call after creating or deleting profiles/owner_quota rows.
 */
function invalidateQuotaCache(appId) {
  _quotaCache.delete(appId);
}

// ─── Quota timezone ──────────────────────────────────────────────────────────

let _cachedTz = null;
let _tzExpiresAt = 0;

async function _getQuotaTimezone() {
  if (_cachedTz && Date.now() < _tzExpiresAt) return _cachedTz;
  const sql = getDb();
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = 'quota_timezone' LIMIT 1
  `;
  _cachedTz = rows[0]?.value || "Asia/Kolkata";
  _tzExpiresAt = Date.now() + 300_000; // 5-min cache
  return _cachedTz;
}

// ─── Period start computation ─────────────────────────────────────────────────

/**
 * Returns the quota period start as a "YYYY-MM-DD" string in the given timezone.
 *  - monthly: first day of the current month
 *  - daily:   current date
 *
 * Uses Intl.DateTimeFormat so no external dependencies.
 */
function getPeriodStart(period, timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;

  return period === "monthly" ? `${year}-${month}-01` : `${year}-${month}-${day}`;
}

// ─── Limit resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the effective limit for (appId, ownerId, channel).
 *
 * Resolution order:
 *  1. owner_quota.overrides[channel]      — owner-specific per-channel override
 *  2. owner's profile limits              — profile assigned to this owner
 *  3. app's default profile limits        — fallback for all owners
 *  4. null                                — no limit
 *
 * @param {object} sql  - tagged-template sql client OR pool client with .query
 * @param {string} appId
 * @param {string} ownerId
 * @param {string} channel
 * @returns {Promise<{limit: number, period: string}|null>}
 */
async function resolveLimit(sql, appId, ownerId, channel) {
  // Step 1 + 2: fetch owner row with joined profile limit
  const ownerRes = await sql.query(
    `SELECT oq.overrides, qpl.limit_count, qpl.period
     FROM owner_quota oq
     LEFT JOIN quota_profile_limits qpl
       ON qpl.profile_id = oq.profile_id AND qpl.channel = $3
     WHERE oq.app_id = $1 AND oq.owner_id = $2
     LIMIT 1`,
    [appId, ownerId, channel]
  );

  if (ownerRes.rows.length > 0) {
    const row = ownerRes.rows[0];
    // Check per-channel override
    const ov = row.overrides?.[channel];
    if (ov && typeof ov.limit === "number") {
      return { limit: ov.limit, period: ov.period || "monthly" };
    }
    // Check owner's profile limit
    if (row.limit_count !== null && row.limit_count !== undefined) {
      return { limit: row.limit_count, period: row.period };
    }
  }

  // Step 3: app default profile
  const defaultRes = await sql.query(
    `SELECT qpl.limit_count, qpl.period
     FROM quota_profiles qp
     JOIN quota_profile_limits qpl ON qpl.profile_id = qp.id AND qpl.channel = $2
     WHERE qp.app_id = $1 AND qp.is_default = true
     LIMIT 1`,
    [appId, channel]
  );

  if (defaultRes.rows.length > 0) {
    return { limit: defaultRes.rows[0].limit_count, period: defaultRes.rows[0].period };
  }

  return null; // no limit configured
}

// ─── Reserve (single notification) ────────────────────────────────────────────

/**
 * Reserve quota for one channel on an EXISTING pg client (already in a transaction).
 * Does not start or commit a transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.ownerId
 * @param {string} [opts.entityId]
 * @param {string} opts.notificationId
 * @param {string} opts.channel
 * @param {number} opts.units      - number of units to reserve (typically 1)
 * @param {{limit: number, period: string}} opts.limitConfig
 * @param {string} opts.timezone
 * @returns {Promise<{blocked: boolean, limit?: number, period?: string, periodStart?: string, used?: number, reserved?: number, remaining?: number}>}
 */
async function _reserveOnClient(client, opts) {
  const { appId, ownerId, entityId, notificationId, channel, units, limitConfig, timezone } = opts;
  const { limit, period } = limitConfig;
  const periodStart = getPeriodStart(period, timezone);

  // Pre-check: units > limit means blocked regardless (also handles first-insert case
  // where the WHERE on DO UPDATE does not apply).
  if (units > limit) {
    return { blocked: true, limit, period, periodStart, remaining: 0 };
  }

  // Atomic upsert. The WHERE on DO UPDATE blocks the counter increment if the
  // running total would exceed limit; when the WHERE fails no row is returned.
  const res = await client.query(
    `INSERT INTO quota_usage (app_id, owner_id, channel, period_start, reserved, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (app_id, owner_id, channel, period_start)
     DO UPDATE SET
       reserved  = quota_usage.reserved + $5,
       updated_at = now()
     WHERE quota_usage.used + quota_usage.reserved + $5 <= $6
     RETURNING used, reserved`,
    [appId, ownerId, channel, periodStart, units, limit]
  );

  if (res.rows.length === 0) {
    // WHERE failed: quota exceeded. Read current counters for reporting.
    const cur = await client.query(
      `SELECT COALESCE(used, 0) AS used, COALESCE(reserved, 0) AS reserved
       FROM quota_usage
       WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
      [appId, ownerId, channel, periodStart]
    );
    const u = cur.rows[0] || { used: 0, reserved: 0 };
    return {
      blocked: true,
      limit,
      period,
      periodStart,
      used: Number(u.used),
      reserved: Number(u.reserved),
      remaining: Math.max(0, limit - u.used - u.reserved),
    };
  }

  const { used, reserved } = res.rows[0];

  // Record the per-notification reservation for stale cleanup and breakdowns.
  await client.query(
    `INSERT INTO quota_reservations
       (notification_id, app_id, owner_id, entity_id, channel, units, period_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (notification_id, channel) DO NOTHING`,
    [notificationId, appId, ownerId, entityId || null, channel, units, periodStart]
  );

  return {
    blocked: false,
    limit,
    period,
    periodStart,
    used: Number(used),
    reserved: Number(reserved),
    remaining: Math.max(0, limit - used - reserved),
  };
}

/**
 * Reserve quota for multiple channels in ONE transaction.
 * Channels are processed in deterministic (alphabetical) order.
 *
 * @param {object} sql  - tagged-template sql client (getDb())
 * @param {object} opts
 * @returns {Promise<{channelResults: Map<string, object>, anyBlocked: boolean}>}
 */
async function reserveForChannels(sql, opts) {
  const { appId, ownerId, entityId, notificationId, channelUnits } = opts;
  // channelUnits: Map<channel, units>

  const timezone = await _getQuotaTimezone();

  // Resolve limits upfront (these are simple reads, no transaction needed)
  const limitConfigs = new Map();
  for (const [channel, units] of channelUnits) {
    if (!units || units <= 0) continue;
    const lim = await resolveLimit(sql, appId, ownerId, channel);
    if (lim) limitConfigs.set(channel, lim);
  }

  if (limitConfigs.size === 0) {
    // No limits configured for any channel → all pass through
    return { channelResults: new Map(), anyBlocked: false };
  }

  const client = await sql.raw.connect();
  const channelResults = new Map();

  try {
    await client.query("BEGIN");

    // Deterministic order: alphabetical by channel name
    const sortedChannels = [...limitConfigs.keys()].sort();

    for (const channel of sortedChannels) {
      const result = await _reserveOnClient(client, {
        appId,
        ownerId,
        entityId,
        notificationId,
        channel,
        units: channelUnits.get(channel) || 1,
        limitConfig: limitConfigs.get(channel),
        timezone,
      });
      channelResults.set(channel, result);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const anyBlocked = [...channelResults.values()].some((r) => r.blocked);
  return { channelResults, anyBlocked };
}

// ─── Reserve for batch ────────────────────────────────────────────────────────

/**
 * Reserve quota for a whole batch in one transaction.
 * Returns acceptedUnits per channel (which may be < requested due to partial acceptance).
 * The caller is responsible for distributing accepted units across recipients in
 * deterministic order.
 *
 * @param {object} sql
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.ownerId
 * @param {Map<string, number>} opts.channelUnits  total units requested per channel
 * @returns {Promise<{channelResults: Map<string, {accepted: number, blocked: number, limit: number, period: string, periodStart: string}>}>}
 */
async function reserveForBatch(sql, opts) {
  const { appId, ownerId, channelUnits } = opts;
  const timezone = await _getQuotaTimezone();

  // Resolve limits
  const limitConfigs = new Map();
  for (const [ch, units] of channelUnits) {
    if (!units || units <= 0) continue;
    const lim = await resolveLimit(sql, appId, ownerId, ch);
    if (lim) limitConfigs.set(ch, lim);
  }

  if (limitConfigs.size === 0) {
    // No limits → accept all
    const results = new Map();
    for (const [ch, units] of channelUnits) {
      results.set(ch, { accepted: units, blocked: 0, limit: Infinity, period: "none", periodStart: null });
    }
    return { channelResults: results };
  }

  const client = await sql.raw.connect();
  const channelResults = new Map();

  try {
    await client.query("BEGIN");

    // Process channels alphabetically
    const sortedChannels = [...limitConfigs.keys()].sort();

    for (const channel of sortedChannels) {
      const { limit, period } = limitConfigs.get(channel);
      const periodStart = getPeriodStart(period, timezone);
      const requested = channelUnits.get(channel) || 0;

      if (requested === 0) continue;

      // Read current usage inside the transaction (locks via FOR UPDATE)
      const usageRes = await client.query(
        `SELECT COALESCE(used, 0) AS used, COALESCE(reserved, 0) AS reserved
         FROM quota_usage
         WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4
         FOR UPDATE`,
        [appId, ownerId, channel, periodStart]
      );

      const cur = usageRes.rows[0] || { used: 0, reserved: 0 };
      const available = Math.max(0, limit - Number(cur.used) - Number(cur.reserved));
      const accepted = Math.min(requested, available);
      const blocked = requested - accepted;

      if (accepted > 0) {
        await client.query(
          `INSERT INTO quota_usage (app_id, owner_id, channel, period_start, reserved, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (app_id, owner_id, channel, period_start)
           DO UPDATE SET reserved = quota_usage.reserved + $5, updated_at = now()`,
          [appId, ownerId, channel, periodStart, accepted]
        );
      }

      channelResults.set(channel, {
        accepted,
        blocked,
        limit,
        period,
        periodStart,
        used: Number(cur.used),
        remaining: Math.max(0, available - accepted),
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // For channels not in limitConfigs, all units are accepted (no limit)
  for (const [ch, units] of channelUnits) {
    if (!channelResults.has(ch)) {
      channelResults.set(ch, { accepted: units, blocked: 0, limit: Infinity, period: "none", periodStart: null });
    }
  }

  return { channelResults };
}

/**
 * Insert a quota_reservations row for a single (notification, channel) pair
 * AFTER the batch reserve has already updated quota_usage.
 * This is idempotent (ON CONFLICT DO NOTHING).
 *
 * @param {object} sql
 */
async function recordBatchReservation(sql, { notificationId, appId, ownerId, entityId, channel, units, periodStart }) {
  if (!periodStart) return; // no limit was configured for this channel
  await sql.query(
    `INSERT INTO quota_reservations
       (notification_id, app_id, owner_id, entity_id, channel, units, period_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (notification_id, channel) DO NOTHING`,
    [notificationId, appId, ownerId, entityId || null, channel, units, periodStart]
  );
}

// ─── Settle ──────────────────────────────────────────────────────────────────

/**
 * Settle a quota reservation on an EXISTING pg client (already in a transaction).
 * Does not start or commit its own transaction.
 *
 * outcome:
 *   'consumed' — charge unit: reserved--, used++
 *   'released' — release without charge: reserved--
 *
 * Idempotent: if the reservation is already settled, does nothing.
 *
 * @param {import('pg').PoolClient} client
 * @param {object} opts
 * @param {string} opts.notificationId
 * @param {string} opts.channel
 * @param {'consumed'|'released'} opts.outcome
 */
async function settleOnClient(client, { notificationId, channel, outcome }) {
  // Only settle rows that are currently 'reserved'
  const res = await client.query(
    `UPDATE quota_reservations
     SET status = $1
     WHERE notification_id = $2 AND channel = $3 AND status = 'reserved'
     RETURNING app_id, owner_id, units, period_start`,
    [outcome, notificationId, channel]
  );

  if (res.rows.length === 0) return; // already settled or no reservation

  const { app_id, owner_id, units, period_start } = res.rows[0];

  if (outcome === "consumed") {
    await client.query(
      `UPDATE quota_usage
       SET reserved   = GREATEST(0, reserved - $5),
           used       = used + $5,
           updated_at = now()
       WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
      [app_id, owner_id, channel, period_start, units]
    );
  } else {
    await client.query(
      `UPDATE quota_usage
       SET reserved   = GREATEST(0, reserved - $5),
           updated_at = now()
       WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
      [app_id, owner_id, channel, period_start, units]
    );
  }
}

// ─── Threshold checking ───────────────────────────────────────────────────────

/**
 * After a successful settle('consumed'), check whether any threshold
 * (80 % or 100 %) has just been crossed for the first time this period.
 * Returns new events that should trigger a quota.threshold webhook.
 *
 * @param {object} sql
 * @param {object} opts
 * @returns {Promise<Array<{appId, ownerId, channel, threshold, limit, used, reserved, period, periodStart}>>}
 */
async function checkThresholds(sql, { appId, ownerId, channel, limit, period }) {
  const timezone = await _getQuotaTimezone();
  const periodStart = getPeriodStart(period, timezone);

  const usageRes = await sql.query(
    `SELECT COALESCE(used, 0) AS used, COALESCE(reserved, 0) AS reserved
     FROM quota_usage
     WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
    [appId, ownerId, channel, periodStart]
  );

  if (usageRes.rows.length === 0) return [];

  const { used, reserved } = usageRes.rows[0];
  const effective = Number(used); // only committed usage counts for threshold
  const crossed = [];

  for (const threshold of [80, 100]) {
    if (limit > 0 && effective * 100 >= threshold * limit) {
      const existing = await sql.query(
        `SELECT 1 FROM quota_threshold_events
         WHERE app_id = $1 AND owner_id = $2 AND channel = $3
           AND period_start = $4 AND threshold = $5`,
        [appId, ownerId, channel, periodStart, threshold]
      );
      if (existing.rows.length === 0) {
        crossed.push({ appId, ownerId, channel, threshold, limit, used: Number(used), reserved: Number(reserved), period, periodStart });
      }
    }
  }
  return crossed;
}

/**
 * Record threshold events in quota_threshold_events (idempotent ON CONFLICT DO NOTHING).
 * Returns only the events that were actually inserted (new firings).
 */
async function recordThresholdEvents(sql, events) {
  const fired = [];
  for (const ev of events) {
    const res = await sql.query(
      `INSERT INTO quota_threshold_events (app_id, owner_id, channel, period_start, threshold)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [ev.appId, ev.ownerId, ev.channel, ev.periodStart, ev.threshold]
    );
    if (res.rows.length > 0) fired.push(ev);
  }
  return fired;
}

// ─── Stale reservation cleanup ────────────────────────────────────────────────

/**
 * Release reservations that are still 'reserved' longer than the configured
 * timeout AND whose notification is in a final state.
 * Called by quota-stale.worker.js.
 *
 * @param {object} sql
 * @returns {Promise<number>} number of reservations released
 */
async function releaseStaleReservations(sql) {
  const settingRes = await sql.query(
    `SELECT value FROM app_settings WHERE key = 'quota_stale_reservation_timeout_minutes' LIMIT 1`
  );
  const minutes = parseInt(settingRes.rows[0]?.value || "60", 10);

  const client = await sql.raw.connect();
  let count = 0;
  try {
    await client.query("BEGIN");

    const staleRes = await client.query(
      `SELECT qr.id, qr.app_id, qr.owner_id, qr.channel, qr.units, qr.period_start
       FROM quota_reservations qr
       JOIN notifications n ON n.id = qr.notification_id
       WHERE qr.status = 'reserved'
         AND qr.created_at < now() - ($1 || ' minutes')::interval
         AND n.status IN ('delivered', 'partial', 'failed')
       FOR UPDATE OF qr SKIP LOCKED
       LIMIT 200`,
      [String(minutes)]
    );

    for (const row of staleRes.rows) {
      await client.query(
        `UPDATE quota_reservations SET status = 'released' WHERE id = $1`,
        [row.id]
      );
      await client.query(
        `UPDATE quota_usage
         SET reserved = GREATEST(0, reserved - $5), updated_at = now()
         WHERE app_id = $1 AND owner_id = $2 AND channel = $3 AND period_start = $4`,
        [row.app_id, row.owner_id, row.channel, row.period_start, row.units]
      );
      count++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return count;
}

// ─── Entity-parent guard ──────────────────────────────────────────────────────

/**
 * Guard entity_id → parent_entity_id consistency.
 * On first sight: INSERT the mapping.
 * On subsequent calls: verify the parent matches.
 *
 * @param {object} sql
 * @param {string} appId
 * @param {string} entityId
 * @param {string} parentEntityId
 * @returns {Promise<{conflict: boolean, storedParent?: string}>}
 */
async function guardEntityParent(sql, appId, entityId, parentEntityId) {
  // Try to INSERT the mapping (idempotent: ON CONFLICT DO NOTHING)
  const insertRes = await sql.query(
    `INSERT INTO entity_parent_map (app_id, entity_id, parent_entity_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (app_id, entity_id) DO NOTHING
     RETURNING parent_entity_id`,
    [appId, entityId, parentEntityId]
  );

  if (insertRes.rows.length > 0) {
    // First-time insert — mapping recorded
    return { conflict: false };
  }

  // Mapping already exists — check consistency
  const existing = await sql.query(
    `SELECT parent_entity_id FROM entity_parent_map
     WHERE app_id = $1 AND entity_id = $2 LIMIT 1`,
    [appId, entityId]
  );

  if (existing.rows.length === 0) {
    // Race condition: another process deleted it between INSERT and SELECT
    return { conflict: false };
  }

  const stored = existing.rows[0].parent_entity_id;
  if (stored !== parentEntityId) {
    return { conflict: true, storedParent: stored };
  }

  return { conflict: false };
}

module.exports = {
  appHasQuotas,
  invalidateQuotaCache,
  getPeriodStart,
  resolveLimit,
  reserveForChannels,
  reserveForBatch,
  recordBatchReservation,
  settleOnClient,
  checkThresholds,
  recordThresholdEvents,
  releaseStaleReservations,
  guardEntityParent,
};
