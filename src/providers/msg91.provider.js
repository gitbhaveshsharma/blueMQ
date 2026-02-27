const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");

const MSG91_API = "https://api.msg91.com/api/v5";

/**
 * MSG91 Provider — handles WhatsApp (and SMS as future capability).
 *
 * Docs: https://docs.msg91.com/
 */
class MSG91Provider extends INotificationProvider {
  constructor() {
    super("msg91");
    this.authKey = config.msg91.authKey;
    this.whatsappNumber = config.msg91.whatsappNumber;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      authkey: this.authKey,
    };
  }

  // ─────────────────────────────────────────────
  //  WHATSAPP
  // ─────────────────────────────────────────────
  async sendWhatsApp(payload) {
    const { body, user, title } = payload;

    if (!user.phone) {
      return { success: false, error: "User has no phone number for WhatsApp" };
    }

    const reqBody = {
      integrated_number: this.whatsappNumber,
      content_type: "text",
      payload: {
        to: user.phone,
        type: "text",
        messaging_product: "whatsapp",
        text: {
          body: title ? `*${title}*\n\n${body}` : body,
        },
      },
    };

    try {
      const res = await axios.post(
        `${MSG91_API}/whatsapp/whatsapp/apis/send-message`,
        reqBody,
        { headers: this._headers() },
      );

      const messageId = res.data?.message_id || res.data?.request_id || null;

      return {
        success: true,
        providerMessageId: messageId,
      };
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      return { success: false, error: String(msg) };
    }
  }

  // Push, Email, InApp are NOT supported by MSG91 in this implementation
}

module.exports = { MSG91Provider };
