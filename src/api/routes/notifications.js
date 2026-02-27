const { Router } = require("express");
const { getDb } = require("../../db");

const router = Router();

/**
 * GET /notifications/:userId
 *
 * Fetch the notification bell-icon list for a user.
 * Supports pagination via ?page=1&limit=20
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

    const [notifications, countResult] = await Promise.all([
      sql`
        SELECT id, type, title, message, data, action_url, status, is_read, read_at, created_at
        FROM notifications
        WHERE app_id = ${appId}
          AND external_user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT count(*)::int AS total
        FROM notifications
        WHERE app_id = ${appId}
          AND external_user_id = ${userId}
      `,
    ]);

    const total = countResult[0]?.total || 0;

    // Unread count
    const unreadResult = await sql`
      SELECT count(*)::int AS unread
      FROM notifications
      WHERE app_id = ${appId}
        AND external_user_id = ${userId}
        AND is_read = false
    `;

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
      RETURNING id
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
    `;

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications] read-all error:", err);
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
