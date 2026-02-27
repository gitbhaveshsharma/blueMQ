const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");

const ONESIGNAL_API = "https://onesignal.com/api/v1";

/**
 * OneSignal Provider — handles push, email, and SMS.
 *
 * Uses the OneSignal REST API v1.
 * Docs: https://documentation.onesignal.com/reference
 */
class OneSignalProvider extends INotificationProvider {
  constructor() {
    super("onesignal");
    this.appId = config.onesignal.appId;
    this.apiKey = config.onesignal.apiKey;
  }

  /** @private — shared HTTP helper */
  _headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${this.apiKey}`,
    };
  }

  // ─────────────────────────────────────────────
  //  PUSH Notification
  // ─────────────────────────────────────────────
  async sendPush(payload) {
    const { title, body, actionUrl, user, data } = payload;

    // Prefer player_id; fall back to external_user_id tagging
    const target = user.onesignal_player_id
      ? { include_player_ids: [user.onesignal_player_id] }
      : { include_external_user_ids: [user.external_user_id || user.id] };

    const reqBody = {
      app_id: this.appId,
      ...target,
      headings: { en: title },
      contents: { en: body },
      url: actionUrl || undefined,
      data: data || {},
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });

      return {
        success: true,
        providerMessageId: res.data.id,
      };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }

  // ─────────────────────────────────────────────
  //  EMAIL
  // ─────────────────────────────────────────────
  async sendEmail(payload) {
    const { title, body, user } = payload;

    if (!user.email) {
      return { success: false, error: "User has no email address" };
    }

    const reqBody = {
      app_id: this.appId,
      include_email_tokens: [user.email],
      email_subject: title,
      email_body: `<html><body>${body}</body></html>`,
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });

      return {
        success: true,
        providerMessageId: res.data.id,
      };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }

  // ─────────────────────────────────────────────
  //  SMS
  // ─────────────────────────────────────────────
  async sendSMS(payload) {
    const { body, user } = payload;

    if (!user.phone) {
      return { success: false, error: "User has no phone number" };
    }

    const reqBody = {
      app_id: this.appId,
      include_phone_numbers: [user.phone],
      name: "BlueMQ SMS",
      sms_from: config.onesignal.smsFrom || undefined,
      contents: { en: body },
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });

      return {
        success: true,
        providerMessageId: res.data.id,
      };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }

  // WhatsApp & InApp are NOT supported by OneSignal
  // — default NotSupportedError will be thrown by base class
}

module.exports = { OneSignalProvider };
