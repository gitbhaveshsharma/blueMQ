"use strict";

const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");
const { extractPhoneNumbers } = require("../utils/user-destinations");

/**
 * Twilio Provider — handles SMS.
 *
 * Multi-recipient support:
 * - SMS: sends to all phone numbers found in user.phone / user.phones / user.mobile / etc.
 *        Each recipient gets an individual API request (Twilio Messages API is per-recipient).
 *
 * Docs: https://www.twilio.com/docs/sms/api
 */
class TwilioProvider extends INotificationProvider {
  constructor(options = {}) {
    super("twilio");
    this.accountSid = options.accountSid || config.twilio.accountSid;
    this.authToken = options.authToken || config.twilio.authToken;
    this.fromNumber = options.fromNumber || config.twilio.fromNumber;
  }

  /**
   * Send SMS to one or more phone numbers via Twilio Messages API.
   * Each recipient is contacted individually (Twilio is per-recipient).
   * Returns success if at least one message is delivered.
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

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      return {
        success: false,
        error:
          "Twilio credentials are incomplete (accountSid, authToken, fromNumber)",
        retryable: false,
      };
    }

    const body = payload?.body || "";
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    if (phones.length > 1) {
      console.info(
        `[twilio] SMS multi-recipient: ${phones.length} numbers`,
      );
    }

    if (phones.length === 1) {
      // Single recipient — simple path
      const params = new URLSearchParams({
        To: phones[0],
        From: this.fromNumber,
        Body: body,
      });

      try {
        const res = await axios.post(endpoint, params.toString(), {
          auth: { username: this.accountSid, password: this.authToken },
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 30000,
        });

        return {
          success: true,
          providerMessageId: res.data?.sid || null,
        };
      } catch (err) {
        const msg = err.response?.data?.message || err.message;
        return { success: false, error: String(msg) };
      }
    }

    // Multi-recipient: send individually, report partial success
    const messageIds = [];
    const failures = [];

    for (const phone of phones) {
      const params = new URLSearchParams({
        To: phone,
        From: this.fromNumber,
        Body: body,
      });

      try {
        const res = await axios.post(endpoint, params.toString(), {
          auth: { username: this.accountSid, password: this.authToken },
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 30000,
        });

        const sid = res.data?.sid || null;
        if (sid) messageIds.push(sid);
        console.info(`[twilio] ✅ SMS sent to ${phone} (sid: ${sid})`);
      } catch (err) {
        const msg = err.response?.data?.message || err.message;
        failures.push(`${phone}: ${msg}`);
        console.error(`[twilio] ❌ SMS failed for ${phone}: ${msg}`);
      }
    }

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
      error: `TWILIO_DISPATCH_FAILED: Failed to deliver to all ${phones.length} recipients (${failures.join("; ")})`,
    };
  }
}

module.exports = { TwilioProvider };
