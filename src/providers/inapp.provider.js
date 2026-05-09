const { INotificationProvider } = require("./interface");
const { getDb } = require("../db");
const { broadcast } = require("../ws");

/**
 * InApp Provider — writes the notification directly to the DB.
 * No external API call needed. The bell-icon API reads from the
 * same `notifications` table.
 *
 * After marking the log entry, broadcasts a real-time WebSocket
 * event so connected clients see the notification instantly.
 */
class InAppProvider extends INotificationProvider {
  constructor() {
    super("inapp");
  }

  async sendInApp(payload) {
    const { notificationId, appId, user, title, body, data, actionUrl } =
      payload;

    // The notification row already exists (created in the /notify route).
    // For in-app we just mark a log entry as "sent" — the notification
    // is already visible via GET /notifications/:userId.

    // Broadcast real-time event to connected WebSocket clients
    const userId = user?.external_user_id;

    if (appId && userId) {
      try {
        // Fetch the full notification row for the broadcast payload
        const sql = getDb();
        const rows = await sql`
          SELECT id, type, title, message, data, action_url, status,
                 is_read, read_at, created_at
          FROM notifications
          WHERE id = ${notificationId}
          LIMIT 1
        `;

        const notification = rows[0] || {
          id: notificationId,
          type: payload.type || "unknown",
          title: title || null,
          message: body || null,
          data: data || {},
          action_url: actionUrl || null,
          status: "delivered",
          is_read: false,
          read_at: null,
          created_at: new Date().toISOString(),
        };

        console.log(
          `[inapp] Broadcasting new_notification — app=${appId} user=${userId} notif=${notificationId}`,
        );
        broadcast(appId, userId, "new_notification", notification);
      } catch (err) {
        // Never fail the delivery because of a broadcast error
        console.warn("[inapp] WebSocket broadcast failed:", err.message);
      }
    } else {
      console.warn(
        `[inapp] Skipping WS broadcast — appId=${appId ?? "MISSING"} userId=${userId ?? "MISSING"}`,
      );
    }

    return {
      success: true,
      providerMessageId: notificationId,
    };
  }
}

module.exports = { InAppProvider };
