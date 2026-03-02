require("dotenv").config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,

  // ─── Database (Neon) ───
  database: {
    url: process.env.DATABASE_URL,
  },

  // ─── Redis (BullMQ) ───
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  // ─── OneSignal ───
  onesignal: {
    appId: process.env.ONESIGNAL_APP_ID,
    apiKey: process.env.ONESIGNAL_API_KEY,
  },

  // ─── WAHA (WhatsApp — self-hosted via Railway private network) ───
  waha: {
    baseUrl: process.env.WAHA_BASE_URL || "http://localhost:3000",
    apiKey: process.env.WAHA_API_KEY || "",
    webhookSecret: process.env.WAHA_WEBHOOK_SECRET || "",
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
};

module.exports = config;
