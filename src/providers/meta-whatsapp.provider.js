const axios = require("axios");
const { INotificationProvider } = require("./interface");
const { META_GRAPH_BASE, META_API_VERSION } = require("../config/meta-graph");
const { extractPhoneNumbers } = require("../utils/user-destinations");

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
    this.baseUrl = META_GRAPH_BASE;
    this.apiVersion = META_API_VERSION;
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
  _buildTemplatePayload(to, { templateName, language, parameters }) {
    const template = {
      name: templateName,
      language: { code: language },
    };
    if (Array.isArray(parameters) && parameters.length > 0) {
      template.components = parameters;
    }
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template,
    };
  }

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
    const {
      metaApiKey,
      metaPhoneNumberId,
      user,
      body,
      actionUrl,
      templateName,
      language,
      parameters,
    } = payload;

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
    // Extract recipient phone(s)
    const recipientPhones = extractPhoneNumbers(user);
    if (!recipientPhones || recipientPhones.length === 0) {
      return {
        success: false,
        error: "RECIPIENT_PHONE_MISSING: No recipient phone number provided",
      };
    }

    const endpoint = this._buildEndpoint(metaPhoneNumberId);
    const headers = this._buildHeaders(metaApiKey);
    const useTemplate = Boolean(templateName && language);

    // Multi-recipient dispatch (e.g. Student + Parent phone numbers)
    if (recipientPhones.length > 1) {
      console.info(
        `[meta-whatsapp] Multi-recipient request: ${recipientPhones.length} numbers mode=${useTemplate ? "template" : "text"} template=${templateName || "none"}`,
      );

      const messageIds = [];
      const failures = [];

      for (const phone of recipientPhones) {
        const formatted = this._formatPhoneNumber(phone);
        if (!formatted || formatted.length < 7) {
          failures.push(`INVALID_PHONE_NUMBER: "${phone}"`);
          continue;
        }

        const requestBody = useTemplate
          ? this._buildTemplatePayload(formatted, {
              templateName,
              language,
              parameters,
            })
          : this._buildMessagePayload(
              formatted,
              actionUrl ? `${body}\n\n🔗 ${actionUrl}` : body,
            );

        try {
          const response = await axios.post(endpoint, requestBody, {
            headers,
            timeout: 30000,
          });
          const mid = response.data?.messages?.[0]?.id || null;
          if (mid) messageIds.push(mid);
          console.info(`[meta-whatsapp] ✅ Sent to ${formatted} (id: ${mid})`);
        } catch (postErr) {
          const errMsg =
            postErr.response?.data?.error?.message || postErr.message;
          failures.push(`${formatted}: ${errMsg}`);
          console.error(
            `[meta-whatsapp] ❌ Failed to send to ${formatted}:`,
            errMsg,
          );
        }
      }

      if (messageIds.length > 0) {
        return {
          success: true,
          providerMessageId: messageIds.join(", "),
          providerMessageIds: messageIds,
          totalSent: messageIds.length,
          totalRecipients: recipientPhones.length,
          partialErrors: failures.length > 0 ? failures : undefined,
        };
      }

      return {
        success: false,
        error: `META_DISPATCH_FAILED: Failed to deliver to all ${recipientPhones.length} recipients (${failures.join("; ")})`,
      };
    }

    // Single recipient dispatch
    const recipientPhone = recipientPhones[0];
    const formattedPhone = this._formatPhoneNumber(recipientPhone);
    if (!formattedPhone || formattedPhone.length < 7) {
      return {
        success: false,
        error: `INVALID_PHONE_NUMBER: "${recipientPhone}" is not a valid phone number`,
      };
    }

    console.info(
      `[meta-whatsapp] Request mode=${useTemplate ? "template" : "text"} template=${templateName || "none"} language=${language || "none"} to=${formattedPhone} parameter_components=${Array.isArray(parameters) ? parameters.length : 0}`,
    );

    const requestBody = useTemplate
      ? this._buildTemplatePayload(formattedPhone, {
          templateName,
          language,
          parameters,
        })
      : this._buildMessagePayload(
          formattedPhone,
          actionUrl ? `${body}\n\n🔗 ${actionUrl}` : body,
        );

    if (useTemplate) {
      console.info(
        `[meta-whatsapp] Template "${templateName}" parameters sent to Meta:`,
        JSON.stringify(requestBody.template?.components || [], null, 2),
      );
    }

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

      console.error(
        `[meta-whatsapp] Meta API call failed (status=${status || err.code || "unknown"}, code=${errorCode || "none"}): ${errorMessage}`,
        JSON.stringify(
          {
            errorCode,
            errorMessage,
            errorDetails: errorData || err.response?.data,
            sentComponents: requestBody?.template?.components || null,
          },
          null,
          2,
        ),
      );

      // Map common Meta API errors to actionable messages
      if (status === 401 || errorCode === 190) {
        return {
          success: false,
          error: `META_AUTH_FAILED: Invalid or expired access token`,
          errorCode,
          errorMessage,
          errorData,
        };
      }

      if (status === 400) {
        if (errorCode === 132000) {
          console.error(
            `[meta-whatsapp] ❌ PARAMETER MISMATCH (#132000): Number of parameters sent does not match what Meta expects for template "${templateName}". Sent components:`,
            JSON.stringify(requestBody?.template?.components || [], null, 2),
          );
        }
        if (errorCode === 131008) {
          console.error(
            `[meta-whatsapp] ❌ REQUIRED PARAMETER MISSING (#131008): Template "${templateName}" is missing a required parameter. Sent components:`,
            JSON.stringify(requestBody?.template?.components || [], null, 2),
          );
        }

        // Check for specific Meta error codes
        if (errorCode === 131030) {
          return {
            success: false,
            error: `META_RECIPIENT_NOT_WHATSAPP: Recipient ${formattedPhone} is not on WhatsApp`,
            errorCode,
            errorMessage,
            errorData,
          };
        }
        if (errorCode === 131047) {
          return {
            success: false,
            error: `META_REENGAGEMENT_REQUIRED: More than 24h since last user message`,
            errorCode,
            errorMessage,
            errorData,
          };
        }
        if (errorCode === 131051) {
          return {
            success: false,
            error: `META_UNSUPPORTED_MESSAGE: Message type not supported`,
            errorCode,
            errorMessage,
            errorData,
          };
        }
        return {
          success: false,
          error: `META_BAD_REQUEST: ${errorMessage}`,
          errorCode,
          errorMessage,
          errorData,
          sentComponents: requestBody?.template?.components || null,
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
        errorCode,
        errorMessage,
      };
    }
  }
}

module.exports = { MetaWhatsAppProvider };
