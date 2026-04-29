/**
 * Per-App Provider Factory
 * ────────────────────────
 * Creates provider instances using per-app credentials from the database.
 * Falls back to server-level (.env) providers if the app has no custom credentials.
 *
 * Provider instances for Firebase are cached per app_id because Firebase Admin
 * SDK requires a named app per service account to avoid conflicts.
 *
 * Usage in workers:
 *   const { getAppProvider } = require('./per-app-factory');
 *   const provider = await getAppProvider(appId, 'push');
 *   const result = await provider.sendPush(payload);
 */

const admin = require("firebase-admin");
const { getDb } = require("../db");
const { registry } = require("./registry");
const config = require("../config");

// ─── In-memory cache for per-app credentials & provider instances ───

/** @type {Map<string, { credentials: object, expires: number }>} */
const credentialsCache = new Map();

/** @type {Map<string, import('firebase-admin').app.App>} */
const firebaseAppCache = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch app credentials from DB with caching.
 * @param {string} appId
 * @returns {Promise<object|null>}
 */
async function getAppCredentials(appId) {
  const cached = credentialsCache.get(appId);
  if (cached && Date.now() < cached.expires) {
    return cached.credentials;
  }

  const sql = getDb();
  const rows = await sql`
    SELECT
      provider_push,
      provider_email,
      provider_sms,
      firebase_project_id,
      firebase_client_email,
      firebase_private_key,
      onesignal_app_id,
      onesignal_api_key,
      resend_api_key,
      resend_from_email
    FROM app_provider_credentials
    WHERE app_id = ${appId}
    LIMIT 1
  `;

  const credentials = rows.length > 0 ? rows[0] : null;
  credentialsCache.set(appId, {
    credentials,
    expires: Date.now() + CACHE_TTL_MS,
  });

  return credentials;
}

/**
 * Clear cached credentials and provider instances for an app.
 * Called when credentials are updated via the settings API.
 */
function clearAppProviderCache(appId) {
  credentialsCache.delete(appId);

  // Clean up Firebase Admin app instance
  const firebaseKey = `fcm-${appId}`;
  const fbApp = firebaseAppCache.get(firebaseKey);
  if (fbApp) {
    fbApp
      .delete()
      .catch((err) =>
        console.warn(
          `[per-app-factory] Failed to delete Firebase app for ${appId}:`,
          err.message,
        ),
      );
    firebaseAppCache.delete(firebaseKey);
  }
}

// ─────────────────────────────────────────────
//  Firebase provider with per-app credentials
// ─────────────────────────────────────────────

const { INotificationProvider } = require("./interface");

function normalizeFirebaseToken(rawValue) {
  if (typeof rawValue !== "string") return null;
  const token = rawValue.trim();
  if (!token) return null;

  if (/^https?:\/\//i.test(token)) {
    try {
      const url = new URL(token);
      const isFcmHost =
        url.hostname === "fcm.googleapis.com" ||
        url.hostname.endsWith(".fcm.googleapis.com");
      const fcmSendPrefix = "/fcm/send/";
      if (isFcmHost && url.pathname.startsWith(fcmSendPrefix)) {
        const extracted = decodeURIComponent(
          url.pathname.slice(fcmSendPrefix.length),
        ).trim();
        return extracted || null;
      }
    } catch {
      // Keep original
    }
  }

  return token;
}

function getDeviceToken(user) {
  const candidates = [
    user?.fcm_token,
    user?.fcmToken,
    user?.firebase_token,
    user?.firebaseToken,
    user?.push_token,
    user?.pushToken,
  ];

  for (const value of candidates) {
    const normalized = normalizeFirebaseToken(value);
    if (normalized) return normalized;
  }

  return null;
}

function serializeData(payload) {
  const source = {
    notification_id: payload.notificationId,
    action_url: payload.actionUrl,
    cta_text: payload.ctaText,
    ...(payload.data || {}),
  };

  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function isNonRetryableFirebaseError(code, message) {
  const normalizedCode = String(code || "").toLowerCase();
  const normalizedMessage = String(message || "").toLowerCase();

  if (
    normalizedCode === "messaging/invalid-registration-token" ||
    normalizedCode === "messaging/registration-token-not-registered" ||
    normalizedCode === "messaging/mismatched-credential"
  ) {
    return true;
  }

  return (
    normalizedMessage.includes(
      "registration token is not a valid fcm registration token",
    ) || normalizedMessage.includes("requested entity was not found")
  );
}

class PerAppFirebaseProvider extends INotificationProvider {
  constructor(appId, credentials) {
    super("firebase");
    this.appId = appId;

    const firebaseKey = `fcm-${appId}`;
    let fbApp = firebaseAppCache.get(firebaseKey);

    if (!fbApp) {
      // Check if Firebase already has this named app
      fbApp = admin.apps.find((app) => app.name === firebaseKey);

      if (!fbApp) {
        const privateKey = (credentials.firebase_private_key || "").replace(
          /\\n/g,
          "\n",
        );
        fbApp = admin.initializeApp(
          {
            credential: admin.credential.cert({
              projectId: credentials.firebase_project_id,
              clientEmail: credentials.firebase_client_email,
              privateKey,
            }),
          },
          firebaseKey,
        );
      }

      firebaseAppCache.set(firebaseKey, fbApp);
    }

    this.messaging = fbApp.messaging();
  }

  async sendPush(payload) {
    const token = getDeviceToken(payload.user);
    if (!token) {
      return {
        success: false,
        error:
          "User has no Firebase token (expected fcm_token or firebase_token)",
        retryable: false,
      };
    }

    try {
      const providerMessageId = await this.messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: serializeData(payload),
      });

      return { success: true, providerMessageId };
    } catch (err) {
      const errorCode = err?.code || err?.errorInfo?.code || "";
      const errorMessage = err?.message || "Firebase send failed";
      const retryable = !isNonRetryableFirebaseError(errorCode, errorMessage);

      return {
        success: false,
        error: errorCode ? `${errorCode}: ${errorMessage}` : errorMessage,
        errorCode,
        retryable,
      };
    }
  }
}

// ─────────────────────────────────────────────
//  OneSignal provider with per-app credentials
// ─────────────────────────────────────────────

const axios = require("axios");

const ONESIGNAL_API = "https://onesignal.com/api/v1";

class PerAppOneSignalProvider extends INotificationProvider {
  constructor(credentials) {
    super("onesignal");
    this.appId = credentials.onesignal_app_id;
    this.apiKey = credentials.onesignal_api_key;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${this.apiKey}`,
    };
  }

  async sendPush(payload) {
    const { title, body, actionUrl, user, data } = payload;
    const target = user.onesignal_player_id
      ? { include_player_ids: [user.onesignal_player_id] }
      : { include_external_user_ids: [user.external_user_id || user.id] };

    const reqBody = {
      app_id: this.appId,
      ...target,
      headings: { en: title },
      contents: { en: body },
      url: actionUrl || undefined,
      data: data || {},
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });
      return { success: true, providerMessageId: res.data.id };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }

  async sendEmail(payload) {
    const { title, body, user } = payload;
    if (!user.email) {
      return { success: false, error: "User has no email address" };
    }

    const reqBody = {
      app_id: this.appId,
      include_email_tokens: [user.email],
      email_subject: title,
      email_body: `<html><body>${body}</body></html>`,
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });
      return { success: true, providerMessageId: res.data.id };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }

  async sendSMS(payload) {
    const { body, user } = payload;
    if (!user.phone) {
      return { success: false, error: "User has no phone number" };
    }

    const reqBody = {
      app_id: this.appId,
      include_phone_numbers: [user.phone],
      name: "BlueMQ SMS",
      contents: { en: body },
    };

    try {
      const res = await axios.post(`${ONESIGNAL_API}/notifications`, reqBody, {
        headers: this._headers(),
      });
      return { success: true, providerMessageId: res.data.id };
    } catch (err) {
      const msg = err.response?.data?.errors?.[0] || err.message;
      return { success: false, error: String(msg) };
    }
  }
}

// ─────────────────────────────────────────────
//  Resend provider with per-app credentials
// ─────────────────────────────────────────────

const { Resend } = require("resend");

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

class PerAppResendProvider extends INotificationProvider {
  constructor(credentials) {
    super("resend");
    this.client = new Resend(credentials.resend_api_key);
    this.fromEmail =
      credentials.resend_from_email || "BlueMQ <onboarding@resend.dev>";
  }

  async sendEmail(payload) {
    const to = payload.user?.email;
    if (!to) return { success: false, error: "User has no email address" };

    try {
      const { data, error } = await this.client.emails.send({
        from: this.fromEmail,
        to,
        subject: payload.title,
        html: buildEmailHtml(payload),
      });

      if (error) {
        return {
          success: false,
          error: error.message || "Resend send failed",
        };
      }
      return { success: true, providerMessageId: data?.id || null };
    } catch (err) {
      return { success: false, error: err.message || "Resend send failed" };
    }
  }
}

// ─────────────────────────────────────────────
//  Main entry: getAppProvider
// ─────────────────────────────────────────────

/**
 * Get the provider for a specific channel for a specific app.
 *
 * Priority:
 *   1. Per-app credentials from DB (if configured)
 *   2. Server-level singleton from registry (.env)
 *
 * @param {string} appId
 * @param {'push'|'email'|'sms'|'whatsapp'|'inapp'} channel
 * @returns {Promise<{provider: INotificationProvider, providerName: string}>}
 */
async function getAppProvider(appId, channel) {
  // WhatsApp and InApp always use the server-level provider
  if (channel === "whatsapp" || channel === "inapp") {
    return {
      provider: registry.getProvider(channel),
      providerName: registry.getProvider(channel).name,
    };
  }

  const credentials = await getAppCredentials(appId);

  if (!credentials) {
    // No per-app config — use server default
    return {
      provider: registry.getProvider(channel),
      providerName: registry.getProvider(channel).name,
    };
  }

  // Determine which provider the app chose for this channel
  const providerChoice =
    channel === "push"
      ? credentials.provider_push
      : channel === "email"
        ? credentials.provider_email
        : channel === "sms"
          ? credentials.provider_sms
          : null;

  // If no provider choice, fall back to server default
  if (!providerChoice) {
    return {
      provider: registry.getProvider(channel),
      providerName: registry.getProvider(channel).name,
    };
  }

  // Create per-app provider instance based on choice
  try {
    if (providerChoice === "firebase" && channel === "push") {
      if (
        !credentials.firebase_project_id ||
        !credentials.firebase_client_email ||
        !credentials.firebase_private_key
      ) {
        console.warn(
          `[per-app-factory] App ${appId} chose Firebase but has incomplete credentials — falling back to server default`,
        );
        return {
          provider: registry.getProvider(channel),
          providerName: registry.getProvider(channel).name,
        };
      }

      const provider = new PerAppFirebaseProvider(appId, credentials);
      return { provider, providerName: "firebase" };
    }

    if (providerChoice === "onesignal") {
      if (!credentials.onesignal_app_id || !credentials.onesignal_api_key) {
        console.warn(
          `[per-app-factory] App ${appId} chose OneSignal but has incomplete credentials — falling back to server default`,
        );
        return {
          provider: registry.getProvider(channel),
          providerName: registry.getProvider(channel).name,
        };
      }

      const provider = new PerAppOneSignalProvider(credentials);
      return { provider, providerName: "onesignal" };
    }

    if (providerChoice === "resend" && channel === "email") {
      if (!credentials.resend_api_key) {
        console.warn(
          `[per-app-factory] App ${appId} chose Resend but has no API key — falling back to server default`,
        );
        return {
          provider: registry.getProvider(channel),
          providerName: registry.getProvider(channel).name,
        };
      }

      const provider = new PerAppResendProvider(credentials);
      return { provider, providerName: "resend" };
    }
  } catch (err) {
    console.error(
      `[per-app-factory] Failed to create ${providerChoice} provider for app ${appId}: ${err.message}`,
    );
  }

  // Final fallback to server default
  return {
    provider: registry.getProvider(channel),
    providerName: registry.getProvider(channel).name,
  };
}

module.exports = {
  getAppProvider,
  getAppCredentials,
  clearAppProviderCache,
};
