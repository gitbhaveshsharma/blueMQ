const axios = require("axios");
const { INotificationProvider } = require("./interface");
const config = require("../config");

class TwilioProvider extends INotificationProvider {
  constructor(options = {}) {
    super("twilio");
    this.accountSid = options.accountSid || config.twilio.accountSid;
    this.authToken = options.authToken || config.twilio.authToken;
    this.fromNumber = options.fromNumber || config.twilio.fromNumber;
  }

  async sendSMS(payload) {
    const to = payload?.user?.phone;
    if (!to) {
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
    const params = new URLSearchParams({
      To: to,
      From: this.fromNumber,
      Body: body,
    });

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    try {
      const res = await axios.post(endpoint, params.toString(), {
        auth: {
          username: this.accountSid,
          password: this.authToken,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
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
}

module.exports = { TwilioProvider };
