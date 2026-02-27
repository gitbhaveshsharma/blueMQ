const { INotificationProvider } = require("./interface");
const { getDb } = require("../db");

/**
 * InApp Provider — writes the notification directly to the DB.
 * No external API call needed. The bell-icon API reads from the
 * same `notifications` table.
 */
class InAppProvider extends INotificationProvider {
  constructor() {
    super("inapp");
  }

  async sendInApp(payload) {
    const { notificationId } = payload;

    // The notification row already exists (created in the /notify route).
    // For in-app we just mark a log entry as "sent" — the notification
    // is already visible via GET /notifications/:userId.
    // (Nothing extra to send — it's already in the DB.)

    return {
      success: true,
      providerMessageId: notificationId,
    };
  }
}

module.exports = { InAppProvider };
