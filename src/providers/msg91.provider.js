const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");

const MSG91_API = "https://api.msg91.com/api/v5";
const MSG91_DEFAULT_FLOW_BASE_API = "https://control.msg91.com/api/v5";

/**
 * MSG91 Provider — handles WhatsApp, SMS, Email and Call.
 *
 * Docs: https://docs.msg91.com/
 */
class MSG91Provider extends INotificationProvider {
  constructor(options = {}) {
    super("msg91");
    this.authKey = options.authKey || config.msg91.authKey;
    this.whatsappNumber = options.whatsappNumber || config.msg91.whatsappNumber;
    this.flowBaseUrl = (
      options.flowBaseUrl ||
      config.msg91.flowBaseUrl ||
      MSG91_DEFAULT_FLOW_BASE_API
    ).replace(/\/+$/, "");
    this.smsFlowId = options.smsFlowId || config.msg91.smsFlowId;
    this.emailFlowId = options.emailFlowId || config.msg91.emailFlowId;
    this.callFlowId = options.callFlowId || config.msg91.callFlowId;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      authkey: this.authKey,
    };
  }

  _normalizePhone(phone) {
    return String(phone || "").replace(/[^0-9]/g, "");
  }

  _formatFlowMobile(phone) {
    const digits = this._normalizePhone(phone);
    if (!digits) return "";

    if (digits.length === 10) {
      return `91${digits}`;
    }
    if (digits.startsWith("0") && digits.length === 11) {
      return `91${digits.slice(1)}`;
    }
    return digits;
  }

  async _sendFlow({ flowId, recipientField, recipientValue, body, payload }) {
    if (!this.authKey) {
      return {
        success: false,
        error: "MSG91 auth key is not configured",
        retryable: false,
      };
    }
    if (!flowId) {
      return {
        success: false,
        error: "MSG91 flow ID is not configured",
        retryable: false,
      };
    }
    if (!recipientValue) {
      return {
        success: false,
        error: `Missing recipient field: ${recipientField}`,
        retryable: false,
      };
    }

    const reqBody = {
      flow_id: flowId,
      [recipientField]: recipientValue,
      ...(body ? { body } : {}),
      ...(payload?.title ? { title: payload.title } : {}),
      ...(payload?.actionUrl ? { action_url: payload.actionUrl } : {}),
      ...(payload?.ctaText ? { cta_text: payload.ctaText } : {}),
      ...(payload?.data && typeof payload.data === "object"
        ? payload.data
        : {}),
    };

    try {
      const res = await axios.post(`${this.flowBaseUrl}/flow/`, reqBody, {
        headers: this._headers(),
        timeout: 30000,
      });

      const messageId =
        res.data?.request_id || res.data?.message_id || res.data?.id || null;

      return { success: true, providerMessageId: messageId };
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      return { success: false, error: String(msg) };
    }
  }

  // ─────────────────────────────────────────────
  //  SMS (Flow API)
  // ─────────────────────────────────────────────
  async sendSMS(payload) {
    const mobile = this._formatFlowMobile(payload?.user?.phone);
    if (!mobile) {
      return {
        success: false,
        error: "User has no phone number",
        retryable: false,
      };
    }

    return this._sendFlow({
      flowId: this.smsFlowId,
      recipientField: "mobiles",
      recipientValue: mobile,
      body: payload?.body,
      payload,
    });
  }

  // ─────────────────────────────────────────────
  //  EMAIL (Flow API)
  // ─────────────────────────────────────────────
  async sendEmail(payload) {
    const email = String(payload?.user?.email || "").trim();
    if (!email) {
      return {
        success: false,
        error: "User has no email address",
        retryable: false,
      };
    }

    return this._sendFlow({
      flowId: this.emailFlowId,
      recipientField: "email",
      recipientValue: email,
      body: payload?.body,
      payload,
    });
  }

  // ─────────────────────────────────────────────
  //  WHATSAPP
  // ─────────────────────────────────────────────
  async sendWhatsApp(payload) {
    const { body, user, title } = payload;

    if (!this.authKey) {
      return {
        success: false,
        error: "MSG91 auth key is not configured",
        retryable: false,
      };
    }
    if (!this.whatsappNumber) {
      return {
        success: false,
        error: "MSG91 WhatsApp integrated number is not configured",
        retryable: false,
      };
    }

    if (!user.phone) {
      return {
        success: false,
        error: "User has no phone number for WhatsApp",
        retryable: false,
      };
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

  // ─────────────────────────────────────────────
  //  CALL (Flow API)
  // ─────────────────────────────────────────────
  async sendCall(payload) {
    const mobile = this._formatFlowMobile(payload?.user?.phone);
    if (!mobile) {
      return {
        success: false,
        error: "User has no phone number for call",
        retryable: false,
      };
    }

    return this._sendFlow({
      flowId: this.callFlowId,
      recipientField: "mobiles",
      recipientValue: mobile,
      body: payload?.body,
      payload,
    });
  }
}

module.exports = { MSG91Provider };
