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

function getDeviceToken(user) {
  return user?.fcm_token || user?.firebase_token || user?.push_token || null;
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

class FirebaseProvider extends INotificationProvider {
  constructor() {
    super("firebase");
    this.messaging = getFirebaseApp().messaging();
  }

  async sendPush(payload) {
    const token = getDeviceToken(payload.user);
    if (!token) {
      return {
        success: false,
        error:
          "User has no Firebase token (expected fcm_token or firebase_token)",
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
      return { success: false, error: err.message || "Firebase send failed" };
    }
  }
}

module.exports = { FirebaseProvider };
