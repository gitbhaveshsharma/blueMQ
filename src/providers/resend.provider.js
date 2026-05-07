const { Resend } = require("resend");
const { INotificationProvider } = require("./interface");
const config = require("../config");
const { buildEmailHtml } = require("../utils/email");

class ResendProvider extends INotificationProvider {
  constructor() {
    super("resend");
    this.client = new Resend(config.resend.apiKey);
    this.fromEmail = config.resend.fromEmail;
  }

  async sendEmail(payload) {
    const to = payload.user?.email;
    if (!to) return { success: false, error: "User has no email address" };
    if (!config.resend.apiKey)
      return { success: false, error: "RESEND_API_KEY is not configured" };

    try {
      const { data, error } = await this.client.emails.send({
        from: this.fromEmail,
        to,
        subject: payload.title,
        html: buildEmailHtml(payload),
      });

      if (error)
        return { success: false, error: error.message || "Resend send failed" };
      return { success: true, providerMessageId: data?.id || null };
    } catch (err) {
      return { success: false, error: err.message || "Resend send failed" };
    }
  }
}

module.exports = { ResendProvider };
