/**
 * INotificationProvider — the contract every provider must implement.
 *
 * Each method receives a standardised payload and returns:
 *   { success: boolean, providerMessageId?: string, error?: string }
 *
 * Throw `NotSupportedError` for channels the provider doesn't handle.
 */

class NotSupportedError extends Error {
  constructor(provider, channel) {
    super(`${provider} does not support channel: ${channel}`);
    this.name = "NotSupportedError";
    this.provider = provider;
    this.channel = channel;
  }
}

/**
 * Base class — concrete providers extend this and override the methods
 * they support.  Unoverridden methods throw NotSupportedError.
 */
class INotificationProvider {
  constructor(name) {
    if (new.target === INotificationProvider) {
      throw new Error(
        "INotificationProvider is abstract and cannot be instantiated directly",
      );
    }
    this.name = name;
  }

  /**
   * @param {object} payload
   * @param {string} payload.notificationId
   * @param {string} payload.title
   * @param {string} payload.body
   * @param {string} payload.actionUrl
   * @param {string} payload.ctaText
   * @param {object} payload.user          — { onesignal_player_id, fcm_token, email, phone, ... }
   * @param {object} [payload.data]        — arbitrary extra data
   * @returns {Promise<{success:boolean, providerMessageId?:string, error?:string}>}
   */
  async sendPush(_payload) {
    throw new NotSupportedError(this.name, "push");
  }

  async sendEmail(_payload) {
    throw new NotSupportedError(this.name, "email");
  }

  async sendSMS(_payload) {
    throw new NotSupportedError(this.name, "sms");
  }

  async sendWhatsApp(_payload) {
    throw new NotSupportedError(this.name, "whatsapp");
  }

  async sendInApp(_payload) {
    throw new NotSupportedError(this.name, "inapp");
  }
}

module.exports = { INotificationProvider, NotSupportedError };
