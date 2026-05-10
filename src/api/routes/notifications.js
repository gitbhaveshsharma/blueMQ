const { Router } = require("express");
const { getDb } = require("../../db");
const { broadcast } = require("../../ws");

const router = Router();

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/**
 * GET /notifications/logs/app
 *
 * App-wide notification log analytics with pagination + filters.
 */
router.get("/logs/app", async (req, res) => {
  try {
    const appId = req.appId;
    const sql = getDb();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const search = normalizeOptionalText(req.query.search);
    const channel = normalizeOptionalText(req.query.channel);
    const status = normalizeOptionalText(req.query.status);
    const provider = normalizeOptionalText(req.query.provider);
    const from = normalizeOptionalText(req.query.from);
    const to = normalizeOptionalText(req.query.to);
    const requestedDays = parseInt(req.query.days, 10);

    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res
        .status(400)
        .json({ error: "Invalid from date. Use YYYY-MM-DD format." });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res
        .status(400)
        .json({ error: "Invalid to date. Use YYYY-MM-DD format." });
    }

    const params = [appId];
    const whereClauses = ["n.app_id = $1"];

    function addParam(value) {
      params.push(value);
      return `$${params.length}`;
    }

    if (search) {
      const searchParam = addParam(`%${search.toLowerCase()}%`);
      whereClauses.push(`(
        LOWER(n.external_user_id) LIKE ${searchParam}
        OR LOWER(COALESCE(n.type, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(n.title, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(n.message, '')) LIKE ${searchParam}
        OR LOWER(COALESCE(nl.provider, '')) LIKE ${searchParam}
        OR CAST(nl.notification_id AS TEXT) ILIKE ${searchParam}
      )`);
    }

    if (channel) {
      const channelParam = addParam(channel.toLowerCase());
      whereClauses.push(`LOWER(nl.channel) = ${channelParam}`);
    }

    if (status) {
      const statusParam = addParam(status.toLowerCase());
      whereClauses.push(`LOWER(nl.status) = ${statusParam}`);
    }

    if (provider) {
      const providerParam = addParam(provider.toLowerCase());
      whereClauses.push(`LOWER(COALESCE(nl.provider, '')) = ${providerParam}`);
    }

    if (from) {
      const fromParam = addParam(from);
      whereClauses.push(`nl.sent_at >= ${fromParam}::date`);
    }

    if (to) {
      const toParam = addParam(to);
      whereClauses.push(`nl.sent_at < (${toParam}::date + interval '1 day')`);
    }

    const normalizedDays =
      Number.isInteger(requestedDays) && requestedDays > 0
        ? Math.min(requestedDays, 365)
        : 30;

    if (!from && !to) {
      const daysParam = addParam(normalizedDays);
      whereClauses.push(
        `nl.sent_at >= now() - (${daysParam}::int * interval '1 day')`,
      );
    }

    const whereSql = whereClauses.join(" AND ");
    const baseFrom = `
      FROM notification_logs nl
      JOIN notifications n ON n.id = nl.notification_id
      WHERE ${whereSql}
    `;

    const listParams = [...params, limit, offset];
    const listQuery = `
      SELECT
        nl.id,
        nl.notification_id,
        n.external_user_id,
        n.type,
        n.title,
        n.message,
        nl.channel,
        nl.status,
        nl.provider,
        nl.provider_message_id,
        nl.attempt_number,
        nl.error,
        nl.sent_at
      ${baseFrom}
      ORDER BY nl.sent_at DESC
      LIMIT $${listParams.length - 1}
      OFFSET $${listParams.length}
    `;

    const [
      listResult,
      totalResult,
      summaryResult,
      channelStatsResult,
      timelineResult,
    ] = await Promise.all([
      sql.query(listQuery, listParams),
      sql.query(`SELECT count(*)::int AS total ${baseFrom}`, params),
      sql.query(
        `
            SELECT
              count(*)::int AS total,
              count(*) FILTER (WHERE nl.status = 'sent')::int AS sent,
              count(*) FILTER (WHERE nl.status = 'failed')::int AS failed,
              count(*) FILTER (WHERE nl.status = 'permanently_failed')::int AS permanently_failed,
              count(*) FILTER (WHERE nl.status = 'pending')::int AS pending,
              count(DISTINCT nl.notification_id)::int AS notifications
            ${baseFrom}
          `,
        params,
      ),
      sql.query(
        `
            SELECT
              nl.channel,
              count(*)::int AS total,
              count(*) FILTER (WHERE nl.status = 'sent')::int AS sent,
              count(*) FILTER (WHERE nl.status IN ('failed', 'permanently_failed'))::int AS failed
            ${baseFrom}
            GROUP BY nl.channel
            ORDER BY total DESC, nl.channel ASC
          `,
        params,
      ),
      sql.query(
        `
            SELECT
              to_char(date_trunc('day', nl.sent_at), 'YYYY-MM-DD') AS day,
              count(*)::int AS total,
              count(*) FILTER (WHERE nl.status = 'sent')::int AS sent,
              count(*) FILTER (WHERE nl.status IN ('failed', 'permanently_failed'))::int AS failed
            ${baseFrom}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
        params,
      ),
    ]);

    const total = totalResult.rows[0]?.total || 0;
    const summary = summaryResult.rows[0] || {
      total: 0,
      sent: 0,
      failed: 0,
      permanently_failed: 0,
      pending: 0,
      notifications: 0,
    };

    return res.json({
      success: true,
      data: listResult.rows || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filters: {
        search: search || "",
        channel: channel || "",
        status: status || "",
        provider: provider || "",
        from: from || "",
        to: to || "",
        days: !from && !to ? normalizedDays : null,
      },
      summary,
      channel_stats: channelStatsResult.rows || [],
      timeline: timelineResult.rows || [],
    });
  } catch (err) {
    console.error("[notifications] app logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /notifications/:userId
 *
 * Fetch the notification bell-icon list for a user.
 * Supports pagination via ?page=1&limit=20
 * Excludes soft-deleted notifications (is_removed = true).
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const appId = req.appId;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const sql = getDb();

    const [notifications, countResult, unreadResult] = await Promise.all([
      sql`
        SELECT id, type, title, message, data, action_url, status, is_read, read_at, created_at
        FROM notifications
        WHERE app_id = ${appId}
          AND external_user_id = ${userId}
          AND is_removed = false
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT count(*)::int AS total
        FROM notifications
        WHERE app_id = ${appId}
          AND external_user_id = ${userId}
          AND is_removed = false
      `,
      sql`
        SELECT count(*)::int AS unread
        FROM notifications
        WHERE app_id = ${appId}
          AND external_user_id = ${userId}
          AND is_read = false
          AND is_removed = false
      `,
    ]);

    const total = countResult[0]?.total || 0;

    return res.json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      unread_count: unreadResult[0]?.unread || 0,
    });
  } catch (err) {
    console.error("[notifications] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /notifications/:userId/unread-count
 *
 * Lightweight endpoint that returns only the unread count.
 * Used by clients on initial load and after WebSocket reconnect.
 */
router.get("/:userId/unread-count", async (req, res) => {
  try {
    const { userId } = req.params;
    const appId = req.appId;
    const sql = getDb();

    const result = await sql`
      SELECT count(*)::int AS unread
      FROM notifications
      WHERE app_id = ${appId}
        AND external_user_id = ${userId}
        AND is_read = false
        AND is_removed = false
    `;

    return res.json({
      success: true,
      unread_count: result[0]?.unread || 0,
    });
  } catch (err) {
    console.error("[notifications] unread-count error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /notifications/:notificationId/read
 *
 * Mark a notification as read.
 */
router.patch("/:notificationId/read", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const appId = req.appId;

    const sql = getDb();

    const result = await sql`
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE id = ${notificationId}
        AND app_id = ${appId}
        AND is_read = false
        AND is_removed = false
      RETURNING id, external_user_id
    `;

    if (result.length === 0) {
      return res
        .status(404)
        .json({ error: "Notification not found or already read" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications] PATCH read error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /notifications/:userId/read-all
 *
 * Mark all notifications as read for a user.
 */
router.post("/:userId/read-all", async (req, res) => {
  try {
    const { userId } = req.params;
    const appId = req.appId;

    const sql = getDb();

    await sql`
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE app_id = ${appId}
        AND external_user_id = ${userId}
        AND is_read = false
        AND is_removed = false
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications] read-all error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /notifications/:notificationId
 *
 * Soft-delete a notification (sets is_removed = true).
 * Broadcasts a "notification_deleted" WebSocket event so
 * connected clients can remove it from their inbox instantly.
 */
router.delete("/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const appId = req.appId;

    const sql = getDb();

    const result = await sql`
      UPDATE notifications
      SET is_removed = true
      WHERE id = ${notificationId}
        AND app_id = ${appId}
        AND is_removed = false
      RETURNING id, external_user_id, is_read
    `;

    if (result.length === 0) {
      return res
        .status(404)
        .json({ error: "Notification not found or already deleted" });
    }

    const { external_user_id: userId, is_read: wasRead } = result[0];

    // Broadcast deletion event to connected clients
    broadcast(appId, userId, "notification_deleted", {
      id: notificationId,
      was_read: wasRead,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications] DELETE error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /notifications/:notificationId/logs
 *
 * Get delivery logs for a specific notification (for debugging).
 */
router.get("/:notificationId/logs", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const appId = req.appId;

    const sql = getDb();

    // Verify the notification belongs to this app
    const notif = await sql`
      SELECT id FROM notifications
      WHERE id = ${notificationId} AND app_id = ${appId}
      LIMIT 1
    `;

    if (notif.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const logs = await sql`
      SELECT channel, status, provider, provider_message_id, attempt_number, error, sent_at
      FROM notification_logs
      WHERE notification_id = ${notificationId}
      ORDER BY sent_at ASC
    `;

    return res.json({ success: true, data: logs });
  } catch (err) {
    console.error("[notifications] logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
