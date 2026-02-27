-- =============================================
-- BlueMQ Notification Service — Neon Schema
-- =============================================

-- 1. Apps (multi-tenant)
CREATE TABLE IF NOT EXISTS apps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  api_key     VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Templates
CREATE TABLE IF NOT EXISTS templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL REFERENCES apps(app_id),
  type        VARCHAR(128) NOT NULL,          -- e.g. "fee_due", "class_reminder"
  channel     VARCHAR(32)  NOT NULL,          -- push / email / sms / whatsapp / in_app
  title       VARCHAR(512),
  body        TEXT NOT NULL,
  cta_text    VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, type, channel)
);

-- 3. Notifications (the master record per user×event)
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            VARCHAR(64)  NOT NULL REFERENCES apps(app_id),
  external_user_id  VARCHAR(255) NOT NULL,
  type              VARCHAR(128) NOT NULL,
  title             VARCHAR(512),
  message           TEXT,
  data              JSONB,                    -- raw payload from caller
  action_url        TEXT,
  status            VARCHAR(32)  NOT NULL DEFAULT 'pending',  -- pending / partial / delivered / failed
  is_read           BOOLEAN NOT NULL DEFAULT false,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_app_user
  ON notifications (app_id, external_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_status
  ON notifications (status);

-- 4. Notification Logs (one row per channel attempt)
CREATE TABLE IF NOT EXISTS notification_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id      UUID NOT NULL REFERENCES notifications(id),
  channel              VARCHAR(32) NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'pending', -- sent / failed / permanently_failed
  provider             VARCHAR(64),
  provider_message_id  VARCHAR(255),
  attempt_number       INT NOT NULL DEFAULT 1,
  error                TEXT,
  sent_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_nid
  ON notification_logs (notification_id);
