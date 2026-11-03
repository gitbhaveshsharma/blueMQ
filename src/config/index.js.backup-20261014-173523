require("dotenv").config({ quiet: true });
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
    smsFrom: process.env.ONESIGNAL_SMS_FROM || "",
  },

  // ─── Firebase Cloud Messaging (Push) ───
  firebase: {
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },

  // ─── Resend (OTP emails) ───
  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    fromEmail:
      process.env.RESEND_FROM_EMAIL || "BlueMQ <onboarding@resend.dev>",
  },

  // ─── Twilio ───
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: process.env.TWILIO_FROM_NUMBER || "",
  },

  // ─── MSG91 ───
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || "",
    whatsappNumber: process.env.MSG91_WHATSAPP_NUMBER || "",
    flowBaseUrl:
      process.env.MSG91_FLOW_BASE_URL || "https://control.msg91.com/api/v5",
    smsFlowId: process.env.MSG91_SMS_FLOW_ID || "",
    emailFlowId: process.env.MSG91_EMAIL_FLOW_ID || "",
    callFlowId: process.env.MSG91_CALL_FLOW_ID || "",
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
    call: {
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
    call: "notifications-call",
    inapp: "notifications-inapp",
  },

  // ─── Provider Routing ───
  providers: buildProviderRouting(),
};

module.exports = config;
