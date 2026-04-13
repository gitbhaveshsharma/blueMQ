const { Resend } = require("resend");
const { INotificationProvider } = require("./interface");
const config = require("../config");

function buildEmailHtml({ title, body, ctaText, actionUrl }) {
  const ctaBlock =
    ctaText && actionUrl
      ? `<p style="margin: 24px 0 0;"><a href="${actionUrl}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600;">${ctaText}</a></p>`
      : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
      <h2 style="margin: 0 0 12px; font-size: 20px;">${title}</h2>
      <p style="margin: 0; white-space: pre-line; line-height: 1.5;">${body}</p>
      ${ctaBlock}
    </div>
  `;
}

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
