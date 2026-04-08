const axios = require("axios");
const { INotificationProvider } = require("./interface");

/**
 * Meta WhatsApp Cloud API Provider
 *
 * Handles WhatsApp messaging via Meta's official Cloud API.
 * Each coach/entity has their own Meta API credentials stored in the database.
 *
 * Only sendWhatsApp() is supported.
 * All other methods throw NotSupportedError (inherited from base class).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
class MetaWhatsAppProvider extends INotificationProvider {
  constructor() {
    super("meta-whatsapp");
    this.baseUrl = "https://graph.facebook.com";
    this.apiVersion = "v19.0";
  }

  /**
   * Format phone number to Meta WhatsApp format.
   * Meta expects digits only, no + prefix (e.g., "919876543210").
   *
   * @param {string} phone — phone number in any format
   * @returns {string} — digits only, no + prefix
   */
  _formatPhoneNumber(phone) {
    if (!phone) return "";
    // Remove all non-digit characters (including +, spaces, dashes)
    return phone.replace(/[^0-9]/g, "");
  }

  /**
   * Build the Meta API endpoint URL.
   *
   * @param {string} phoneNumberId — Meta phone number ID
   * @returns {string} — full API endpoint URL
   */
  _buildEndpoint(phoneNumberId) {
    return `${this.baseUrl}/${this.apiVersion}/${phoneNumberId}/messages`;
  }

  /**
   * Build authorization headers for Meta API.
   *
   * @param {string} accessToken — Meta permanent access token
   * @returns {object} — headers object
   */
  _buildHeaders(accessToken) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * Build the message payload for Meta WhatsApp API.
   *
   * @param {string} to — recipient phone number (digits only)
   * @param {string} body — message text
   * @returns {object} — Meta API request body
   */
  _buildMessagePayload(to, body) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    };
  }

  /**
   * Send a WhatsApp text message via Meta Cloud API.
   *
   * @param {object} payload
   * @param {string} payload.metaApiKey       — Meta permanent access token
   * @param {string} payload.metaPhoneNumberId — Meta phone number ID
   * @param {object} payload.user             — { phone, ... }
   * @param {string} payload.body             — rendered message body
   * @param {string} [payload.actionUrl]      — optional deep-link appended to message
   * @returns {Promise<{success:boolean, providerMessageId?:string, error?:string}>}
   */
  async sendWhatsApp(payload) {
    const { metaApiKey, metaPhoneNumberId, user, body, actionUrl } = payload;

    // Validate required Meta credentials
    if (!metaApiKey) {
      return {
        success: false,
        error: "META_API_KEY_MISSING: No Meta API key provided",
      };
    }

    if (!metaPhoneNumberId) {
      return {
        success: false,
        error: "META_PHONE_NUMBER_ID_MISSING: No Meta phone number ID provided",
      };
    }

    // Validate recipient phone
    const recipientPhone = user?.phone;
    if (!recipientPhone) {
      return {
        success: false,
        error: "RECIPIENT_PHONE_MISSING: No recipient phone number provided",
      };
    }

    // Format phone number for Meta API
    const formattedPhone = this._formatPhoneNumber(recipientPhone);
    if (!formattedPhone || formattedPhone.length < 7) {
      return {
        success: false,
        error: `INVALID_PHONE_NUMBER: "${recipientPhone}" is not a valid phone number`,
      };
    }

    // Build the full message text
    const messageText = actionUrl ? `${body}\n\n🔗 ${actionUrl}` : body;

    // Build request
    const endpoint = this._buildEndpoint(metaPhoneNumberId);
    const headers = this._buildHeaders(metaApiKey);
    const requestBody = this._buildMessagePayload(formattedPhone, messageText);

    try {
      const response = await axios.post(endpoint, requestBody, {
        headers,
        timeout: 30000,
      });

      // Meta returns { messages: [{ id: "wamid.xxx" }] } on success
      const messageId = response.data?.messages?.[0]?.id || null;

      return {
        success: true,
        providerMessageId: messageId,
      };
    } catch (err) {
      const status = err.response?.status;
      const errorData = err.response?.data?.error;
      const errorMessage =
        errorData?.message || err.response?.data?.message || err.message;
      const errorCode = errorData?.code;

      // Map common Meta API errors to actionable messages
      if (status === 401 || errorCode === 190) {
        return {
          success: false,
          error: `META_AUTH_FAILED: Invalid or expired access token`,
        };
      }

      if (status === 400) {
        // Check for specific Meta error codes
        if (errorCode === 131030) {
          return {
            success: false,
            error: `META_RECIPIENT_NOT_WHATSAPP: Recipient ${formattedPhone} is not on WhatsApp`,
          };
        }
        if (errorCode === 131047) {
          return {
            success: false,
            error: `META_REENGAGEMENT_REQUIRED: More than 24h since last user message`,
          };
        }
        if (errorCode === 131051) {
          return {
            success: false,
            error: `META_UNSUPPORTED_MESSAGE: Message type not supported`,
          };
        }
        return {
          success: false,
          error: `META_BAD_REQUEST: ${errorMessage}`,
        };
      }

      if (status === 403) {
        return {
          success: false,
          error: `META_FORBIDDEN: Access denied — check phone number ID permissions`,
        };
      }

      if (status === 429) {
        return {
          success: false,
          error: `META_RATE_LIMITED: Too many requests — try again later`,
        };
      }

      if (
        err.code === "ECONNREFUSED" ||
        err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT"
      ) {
        return {
          success: false,
          error: `META_UNREACHABLE: Could not connect to Meta API`,
        };
      }

      return {
        success: false,
        error: `META_ERROR: ${errorMessage || "Unknown error"}`,
      };
    }
  }
}

module.exports = { MetaWhatsAppProvider };
