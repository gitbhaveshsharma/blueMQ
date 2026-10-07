"use strict";

const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");
const {
  extractPhoneNumbers,
  extractEmails,
} = require("../utils/user-destinations");

const MSG91_API = "https://api.msg91.com/api/v5";
const MSG91_DEFAULT_FLOW_BASE_API = "https://control.msg91.com/api/v5";

/**
 * MSG91 Provider — handles WhatsApp, SMS, Email and Call.
 *
 * Multi-recipient support:
 * - SMS  / Call : sends to all phone numbers found in user.phone / user.phones / user.mobile / etc.
 * - Email       : sends to all email addresses found in user.email / user.emails.
 * - WhatsApp    : sends to all phone numbers found in user.phone / user.phones / user.mobile / etc.
 *
 * Docs: https://docs.msg91.com/
 */
class MSG91Provider extends INotificationProvider {
  constructor(options = {}) {
    super("msg91");
    this.authKey = options.authKey || config.msg91.authKey;
    this.whatsappNumber =
      options.whatsappNumber || config.msg91.whatsappNumber;
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
  //  SMS (Flow API) — multi-recipient
  // ─────────────────────────────────────────────

  /**
   * Send SMS to one or more phone numbers via MSG91 Flow API.
   * MSG91 accepts a comma-separated list of mobiles in a single flow request.
   */
  async sendSMS(payload) {
    const phones = extractPhoneNumbers(payload?.user);
    if (!phones || phones.length === 0) {
      return {
        success: false,
        error: "User has no phone number",
        retryable: false,
      };
    }

    const mobiles = phones
      .map((p) => this._formatFlowMobile(p))
      .filter(Boolean)
      .join(",");

    if (!mobiles) {
      return {
        success: false,
        error: "No valid phone numbers found for SMS",
        retryable: false,
      };
    }

    if (phones.length > 1) {
      console.info(
        `[msg91] SMS multi-recipient: ${phones.length} numbers → "${mobiles}"`,
      );
    }

    return this._sendFlow({
      flowId: this.smsFlowId,
      recipientField: "mobiles",
      recipientValue: mobiles,
      body: payload?.body,
      payload,
    });
  }

  // ─────────────────────────────────────────────
  //  EMAIL (Flow API) — multi-recipient
  // ─────────────────────────────────────────────

  /**
   * Send email to one or more addresses via MSG91 Flow API.
   * Iterates over each address individually since MSG91 flow
   * expects a single "email" field per request.
   */
  async sendEmail(payload) {
    const emails = extractEmails(payload?.user);
    if (!emails || emails.length === 0) {
      return {
        success: false,
        error: "User has no email address",
        retryable: false,
      };
    }

    if (emails.length === 1) {
      return this._sendFlow({
        flowId: this.emailFlowId,
        recipientField: "email",
        recipientValue: emails[0],
        body: payload?.body,
        payload,
      });
    }

    // Multi-email: send individually, report partial success
    console.info(
      `[msg91] Email multi-recipient: ${emails.length} addresses`,
    );

    const messageIds = [];
    const failures = [];

    for (const email of emails) {
      const result = await this._sendFlow({
        flowId: this.emailFlowId,
        recipientField: "email",
        recipientValue: email,
        body: payload?.body,
        payload,
      });

      if (result.success) {
        if (result.providerMessageId) messageIds.push(result.providerMessageId);
        console.info(`[msg91] ✅ Email sent to ${email}`);
      } else {
        failures.push(`${email}: ${result.error}`);
        console.error(`[msg91] ❌ Email failed for ${email}: ${result.error}`);
      }
    }

    if (messageIds.length > 0) {
      return {
        success: true,
        providerMessageId: messageIds.join(", "),
        providerMessageIds: messageIds,
        totalSent: messageIds.length,
        totalRecipients: emails.length,
        partialErrors: failures.length > 0 ? failures : undefined,
      };
    }

    return {
      success: false,
      error: `MSG91_EMAIL_DISPATCH_FAILED: Failed to deliver to all ${emails.length} recipients (${failures.join("; ")})`,
    };
  }

  // ─────────────────────────────────────────────
  //  WHATSAPP — multi-recipient
  // ─────────────────────────────────────────────

  /**
   * Send WhatsApp message to one or more phone numbers via MSG91.
   * Iterates over each number individually (MSG91 WhatsApp API is per-recipient).
   */
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

    const phones = extractPhoneNumbers(user);
    if (!phones || phones.length === 0) {
      return {
        success: false,
        error: "User has no phone number for WhatsApp",
        retryable: false,
      };
    }

    if (phones.length > 1) {
      console.info(
        `[msg91] WhatsApp multi-recipient: ${phones.length} numbers`,
      );
    }

    const messageIds = [];
    const failures = [];

    for (const phone of phones) {
      const reqBody = {
        integrated_number: this.whatsappNumber,
        content_type: "text",
        payload: {
          to: phone,
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

        const messageId =
          res.data?.message_id || res.data?.request_id || null;
        if (messageId) messageIds.push(messageId);
        console.info(
          `[msg91] ✅ WhatsApp sent to ${phone} (id: ${messageId})`,
        );
      } catch (err) {
        const msg = err.response?.data?.message || err.message;
        failures.push(`${phone}: ${msg}`);
        console.error(
          `[msg91] ❌ WhatsApp failed for ${phone}: ${msg}`,
        );
      }
    }

    if (phones.length === 1) {
      // Single recipient — propagate failure cleanly
      if (failures.length > 0) {
        return { success: false, error: failures[0] };
      }
      return {
        success: true,
        providerMessageId: messageIds[0] || null,
      };
    }

    // Multi-recipient
    if (messageIds.length > 0) {
      return {
        success: true,
        providerMessageId: messageIds.join(", "),
        providerMessageIds: messageIds,
        totalSent: messageIds.length,
        totalRecipients: phones.length,
        partialErrors: failures.length > 0 ? failures : undefined,
      };
    }

    return {
      success: false,
      error: `MSG91_WHATSAPP_DISPATCH_FAILED: Failed to deliver to all ${phones.length} recipients (${failures.join("; ")})`,
    };
  }

  // ─────────────────────────────────────────────
  //  CALL (Flow API) — multi-recipient
  // ─────────────────────────────────────────────

  /**
   * Initiate a call to one or more phone numbers via MSG91 Flow API.
   * MSG91 accepts a comma-separated list of mobiles in a single flow request.
   */
  async sendCall(payload) {
    const phones = extractPhoneNumbers(payload?.user);
    if (!phones || phones.length === 0) {
      return {
        success: false,
        error: "User has no phone number for call",
        retryable: false,
      };
    }

    const mobiles = phones
      .map((p) => this._formatFlowMobile(p))
      .filter(Boolean)
      .join(",");

    if (!mobiles) {
      return {
        success: false,
        error: "No valid phone numbers found for call",
        retryable: false,
      };
    }

    if (phones.length > 1) {
      console.info(
        `[msg91] Call multi-recipient: ${phones.length} numbers → "${mobiles}"`,
      );
    }

    return this._sendFlow({
      flowId: this.callFlowId,
      recipientField: "mobiles",
      recipientValue: mobiles,
      body: payload?.body,
      payload,
    });
  }
}

module.exports = { MSG91Provider };
