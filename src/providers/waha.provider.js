const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");

/**
 * WAHA Provider — handles WhatsApp via self-hosted WAHA instance.
 *
 * Only sendWhatsApp() is supported.
 * All other methods throw NotSupportedError (inherited from base class).
 *
 * WAHA runs as a Docker container on Railway's private network.
 * Docs: https://waha.devlike.pro/docs/overview/introduction/
 */
class WahaProvider extends INotificationProvider {
  constructor() {
    super("waha");
    this.baseUrl = config.waha.baseUrl;
    this.apiKey = config.waha.apiKey;
  }

  /** @private — shared HTTP headers for WAHA API calls */
  _headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
    };
  }

  /**
   * Send a WhatsApp text message via WAHA.
   *
   * @param {object} payload
   * @param {string} payload.session    — WAHA session name (e.g. "tutrsy-coaching456")
   * @param {string} payload.phone      — phone number without + prefix (e.g. "919876543210")
   * @param {string} payload.message    — rendered notification body
   * @param {string} [payload.action_url] — optional deep-link appended to message
   * @returns {Promise<{success:boolean, providerMessageId?:string, error?:string}>}
   */
  async sendWhatsApp(payload) {
    const { session, phone, message, action_url } = payload;

    // Build the full message text
    const text = action_url ? `${message}\n\n🔗 ${action_url}` : message;

    // WAHA chatId format: "919876543210@c.us"
    const chatId = `${phone.replace(/[^0-9]/g, "")}@c.us`;

    const reqBody = {
      session,
      chatId,
      text,
    };

    try {
      const res = await axios.post(`${this.baseUrl}/api/sendText`, reqBody, {
        headers: this._headers(),
        timeout: config.waha.requestTimeoutMs,
      });

      return {
        success: true,
        providerMessageId: res.data?.id || res.data?.key?.id || null,
      };
    } catch (err) {
      const status = err.response?.status;
      const errorMsg = err.response?.data?.message || err.message;

      if (status === 404) {
        throw new Error("SESSION_NOT_FOUND");
      }
      if (status === 400) {
        throw new Error(`INVALID_REQUEST: ${errorMsg}`);
      }
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT"
      ) {
        throw new Error("WAHA_UNREACHABLE");
      }

      throw new Error(errorMsg || "WAHA_UNKNOWN_ERROR");
    }
  }
}

module.exports = { WahaProvider };
