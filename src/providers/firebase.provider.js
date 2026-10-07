const admin = require("firebase-admin");
const { INotificationProvider } = require("./interface");
const config = require("../config");

function parseServiceAccountJson() {
  if (!config.firebase.serviceAccountJson) return null;
  return JSON.parse(config.firebase.serviceAccountJson);
}

function getServiceAccountFromFields() {
  const { projectId, clientEmail, privateKey } = config.firebase;
  if (!projectId || !clientEmail || !privateKey) return null;

  return { projectId, clientEmail, privateKey };
}

function getServiceAccount() {
  try {
    return parseServiceAccountJson() || getServiceAccountFromFields();
  } catch (err) {
    throw new Error(
      `[firebase] Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}`,
    );
  }
}

function getFirebaseApp() {
  const existing = admin.apps.find((app) => app.name === "bluemq-fcm");
  if (existing) return existing;

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      "[firebase] Missing credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY",
    );
  }

  return admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount) },
    "bluemq-fcm",
  );
}

function normalizeFirebaseToken(rawValue) {
  if (typeof rawValue !== "string") return null;

  const token = rawValue.trim();
  if (!token) return null;

  // Some apps store a PushSubscription endpoint URL in push_token.
  // For FCM-backed web push endpoints, extract the actual registration token.
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
      // Keep original token if it isn't a valid URL.
    }
  }

  return token;
}

const { extractPushTokens } = require("../utils/user-destinations");

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
    normalizedMessage.includes("registration token is not a valid fcm registration token") ||
    normalizedMessage.includes("requested entity was not found")
  );
}

class FirebaseProvider extends INotificationProvider {
  constructor() {
    super("firebase");
    this.messaging = getFirebaseApp().messaging();
  }

  async sendPush(payload) {
    const tokens = extractPushTokens(payload.user);
    if (!tokens || tokens.length === 0) {
      return {
        success: false,
        error:
          "User has no Firebase token (expected fcm_token, fcm_tokens, firebase_token, or push_token)",
        retryable: false,
      };
    }

    try {
      const fcmData = {
        title: payload.title || "",
        body: payload.body || "",
        ...serializeData(payload),
      };

      if (tokens.length === 1) {
        console.log(
          "[firebase] Sending data-only message to 1 token:",
          JSON.stringify({ token: tokens[0].slice(0, 20) + "...", data: fcmData }),
        );
        const providerMessageId = await this.messaging.send({
          token: tokens[0],
          data: fcmData,
        });
        return { success: true, providerMessageId };
      }

      console.log(
        `[firebase] Sending multicast message to ${tokens.length} tokens:`,
        JSON.stringify({ tokens_count: tokens.length, data: fcmData }),
      );

      const batchResponse = await this.messaging.sendEachForMulticast({
        tokens,
        data: fcmData,
      });

      const messageIds = batchResponse.responses
        .filter((r) => r.success && r.messageId)
        .map((r) => r.messageId);

      if (batchResponse.successCount > 0) {
        return {
          success: true,
          providerMessageId: messageIds.join(", "),
          providerMessageIds: messageIds,
          totalSent: batchResponse.successCount,
          totalTokens: tokens.length,
        };
      }

      const firstFailure = batchResponse.responses.find((r) => !r.success);
      const err = firstFailure?.error;
      const errorCode = err?.code || "";
      const errorMessage = err?.message || "All tokens failed delivery";

      return {
        success: false,
        error: errorCode ? `${errorCode}: ${errorMessage}` : errorMessage,
        errorCode,
        retryable: !isNonRetryableFirebaseError(errorCode, errorMessage),
      };
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

module.exports = { FirebaseProvider };
