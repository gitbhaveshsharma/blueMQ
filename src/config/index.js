require("dotenv").config();
const { buildProviderRouting } = require("./provider-routing");
const { buildRedisConfig } = require("./redis-runtime");

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,

  // ─── Database (Neon) ───
  database: {
    url: process.env.DATABASE_URL,
    connectionTimeoutMs:
      parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 30000,
    maxRetries: parseInt(process.env.DB_MAX_RETRIES, 10) || 3,
    retryDelayMs: parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000,
  },

  // ─── Redis (BullMQ) ───
  redis: buildRedisConfig(),

  // ─── OneSignal ───
  onesignal: {
    appId: process.env.ONESIGNAL_APP_ID,
    apiKey: process.env.ONESIGNAL_API_KEY,
  },

  // ─── Firebase Cloud Messaging (Push) ───
  firebase: {
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },

  // ─── WAHA (WhatsApp — self-hosted via Railway private network) ───
  waha: {
    baseUrl: process.env.WAHA_BASE_URL || "http://localhost:3000",
    apiKey: process.env.WAHA_API_KEY || "",
    webhookSecret: process.env.WAHA_WEBHOOK_SECRET || "",
    requestTimeoutMs:
      parseInt(process.env.WAHA_REQUEST_TIMEOUT_MS, 10) || 30000,
    stateTimeoutMs: parseInt(process.env.WAHA_STATE_TIMEOUT_MS, 10) || 3500,
    qrTimeoutMs: parseInt(process.env.WAHA_QR_TIMEOUT_MS, 10) || 5000,
    writeTimeoutMs: parseInt(process.env.WAHA_WRITE_TIMEOUT_MS, 10) || 15000,
    pollAttempts: parseInt(process.env.WAHA_POLL_ATTEMPTS, 10) || 15,
    pollDelayMs: parseInt(process.env.WAHA_POLL_DELAY_MS, 10) || 2000,
    reconcileCooldownMs:
      parseInt(process.env.WAHA_RECONCILE_COOLDOWN_MS, 10) || 8000,
  },

  // ─── Resend (OTP emails) ───
  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    fromEmail:
      process.env.RESEND_FROM_EMAIL || "BlueMQ <onboarding@resend.dev>",
  },

  // ─── Base URL (for webhook configs) ───
  baseUrl: process.env.BASE_URL || "http://localhost:3001",

  // ─── Service Auth (internal only — never expose to clients) ───
  serviceApiKeySecret: process.env.SERVICE_API_KEY_SECRET || "dev-secret",

  // ─── Worker Concurrency ───
  workers: {
    push: {
      concurrency: 10,
      retries: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
    email: {
      concurrency: 5,
      retries: 3,
      backoff: { type: "exponential", delay: 10000 },
    },
    sms: {
      concurrency: 5,
      retries: 5,
      backoff: { type: "exponential", delay: 30000 },
    },
    whatsapp: {
      concurrency: 5,
      retries: 5,
      backoff: { type: "exponential", delay: 30000 },
    },
    inapp: {
      concurrency: 20,
      retries: 2,
      backoff: { type: "fixed", delay: 2000 },
    },
  },

  // ─── Queue Names ───
  queues: {
    push: "notifications-push",
    email: "notifications-email",
    sms: "notifications-sms",
    whatsapp: "notifications-whatsapp",
    inapp: "notifications-inapp",
  },

  // ─── Provider Routing ───
  providers: buildProviderRouting(),
};

module.exports = config;
