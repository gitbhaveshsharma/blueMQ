-- =============================================
-- BlueMQ Notification Service — Neon Schema
-- =============================================

-- 1. Apps (multi-tenant)
CREATE TABLE IF NOT EXISTS apps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255),
  api_key     VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1b. OTP codes for email-based auth
CREATE TABLE IF NOT EXISTS otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  purpose     VARCHAR(32)  NOT NULL,
  app_id      VARCHAR(64),
  app_name    VARCHAR(255),
  expires_at  TIMESTAMPTZ  NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otps_email_purpose
  ON otps (email, purpose, created_at DESC);

-- 2. Templates
CREATE TABLE IF NOT EXISTS templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL REFERENCES apps(app_id),
  type        VARCHAR(128) NOT NULL,          -- e.g. "fee_due", "class_reminder"
  channel     VARCHAR(32)  NOT NULL,          -- push / email / sms / whatsapp / in_app (canonical)
  title       VARCHAR(512),
  body        TEXT NOT NULL,
  body_format VARCHAR(16)  NOT NULL DEFAULT 'text', -- text / html (email)
  cta_text    VARCHAR(255),
  cta_url     TEXT,
  condition_key   VARCHAR(128),               -- optional, e.g. "request_status"
  condition_value VARCHAR(255),               -- optional, e.g. "APPROVED"
  variant_key     VARCHAR(255) NOT NULL DEFAULT 'default',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, type, channel, variant_key)
);

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS body_format VARCHAR(16) NOT NULL DEFAULT 'text';

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS cta_url TEXT;

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS condition_key VARCHAR(128);

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS condition_value VARCHAR(255);

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS variant_key VARCHAR(255) NOT NULL DEFAULT 'default';

UPDATE templates
SET
  body_format = 'text'
WHERE body_format IS NULL OR btrim(body_format) = '';

UPDATE templates
SET variant_key = 'default'
WHERE variant_key IS NULL OR btrim(variant_key) = '';

ALTER TABLE templates
  ALTER COLUMN body_format SET NOT NULL;

ALTER TABLE templates
  ALTER COLUMN variant_key SET NOT NULL;

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS templates_app_id_type_channel_key;

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS templates_app_id_type_channel_variant_key;

ALTER TABLE templates
  ADD CONSTRAINT templates_app_id_type_channel_variant_key
  UNIQUE (app_id, type, channel, variant_key);

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS chk_templates_condition_pair;

ALTER TABLE templates
  ADD CONSTRAINT chk_templates_condition_pair
  CHECK (
    (condition_key IS NULL AND condition_value IS NULL)
    OR
    (condition_key IS NOT NULL AND condition_value IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_templates_lookup
  ON templates (app_id, type, channel, is_active, updated_at DESC);

-- Normalize legacy inapp alias to canonical in_app, preserving the latest row.
UPDATE templates AS canonical
SET
  title = legacy.title,
  body = legacy.body,
  body_format = legacy.body_format,
  cta_text = legacy.cta_text,
  cta_url = legacy.cta_url,
  condition_key = legacy.condition_key,
  condition_value = legacy.condition_value,
  is_active = legacy.is_active,
  updated_at = legacy.updated_at
FROM templates AS legacy
WHERE canonical.app_id = legacy.app_id
  AND canonical.type = legacy.type
  AND canonical.channel = 'in_app'
  AND legacy.channel = 'inapp'
  AND canonical.variant_key = COALESCE(legacy.variant_key, 'default')
  AND legacy.updated_at > canonical.updated_at;

DELETE FROM templates AS legacy
USING templates AS canonical
WHERE legacy.app_id = canonical.app_id
  AND legacy.type = canonical.type
  AND legacy.channel = 'inapp'
  AND canonical.channel = 'in_app'
  AND canonical.variant_key = COALESCE(legacy.variant_key, 'default');

UPDATE templates
SET channel = 'in_app', updated_at = now()
WHERE channel = 'inapp';

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

-- Soft-delete column: removed notifications are hidden from the inbox
-- but retained in DB for audit / analytics.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_removed BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup for inbox queries that exclude removed notifications
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (app_id, external_user_id, is_removed, created_at DESC)
  WHERE is_removed = false;


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

-- 5. WhatsApp Sessions (one per entity / coaching center)
-- Meta Cloud API only.
-- The existing waha_session column is retained as a generic session identifier
-- for backward compatibility with previously deployed databases.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                   VARCHAR(64)  NOT NULL REFERENCES apps(app_id),
  entity_id                VARCHAR(255) NOT NULL,
  parent_entity_id         VARCHAR(255) DEFAULT NULL, -- optional parent entity for fallback
  waha_session             VARCHAR(255) NOT NULL,
  phone_number             VARCHAR(20),
  status                   VARCHAR(32)  NOT NULL DEFAULT 'pending',
  qr_code                  TEXT,
  connected_at             TIMESTAMPTZ,
  disconnected_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Meta WhatsApp Cloud API fields
  connection_type          VARCHAR(20)  NOT NULL DEFAULT 'meta',
  meta_api_key             TEXT         DEFAULT NULL,
  meta_phone_number_id     VARCHAR(100) DEFAULT NULL,
  meta_business_account_id VARCHAR(100) DEFAULT NULL,
  UNIQUE (app_id, entity_id),
  CONSTRAINT chk_connection_type CHECK (connection_type = 'meta')
);

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) NOT NULL DEFAULT 'meta';

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS parent_entity_id VARCHAR(255) DEFAULT NULL;

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_api_key TEXT DEFAULT NULL;

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(100) DEFAULT NULL;

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_business_account_id VARCHAR(100) DEFAULT NULL;

-- Drop old constraints if they exist (idempotent)
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_waha_session_key;
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS chk_connection_type;

-- Convert legacy non-meta rows to disconnected meta rows so the new constraint is safe.
UPDATE whatsapp_sessions
SET
  connection_type = 'meta',
  status = CASE WHEN status = 'active' THEN 'disconnected' ELSE status END,
  qr_code = NULL
WHERE connection_type IS DISTINCT FROM 'meta';

ALTER TABLE whatsapp_sessions
  ALTER COLUMN connection_type SET DEFAULT 'meta';

ALTER TABLE whatsapp_sessions
  ADD CONSTRAINT chk_connection_type CHECK (connection_type = 'meta');

COMMENT ON COLUMN whatsapp_sessions.parent_entity_id IS
  'Optional parent entity used when the child inherits WhatsApp credentials';

-- Fast lookup for active sessions during message sending
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_lookup
  ON whatsapp_sessions (app_id, entity_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_parent_lookup
  ON whatsapp_sessions (app_id, parent_entity_id)
  WHERE status = 'active';

-- Fast lookup for webhook → DB row mapping
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_waha
  ON whatsapp_sessions (waha_session);

-- 6. Per-app provider credentials & routing
-- Each app stores their own notification provider API keys and chooses
-- which provider to use per channel (push, email, sms, whatsapp, call).
-- Falls back to server-level .env credentials if not configured.
CREATE TABLE IF NOT EXISTS app_provider_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                VARCHAR(64) NOT NULL UNIQUE REFERENCES apps(app_id),

  -- Provider Routing (which provider per channel)
  provider_push         VARCHAR(32)  DEFAULT NULL,
  provider_email        VARCHAR(32)  DEFAULT NULL,
  provider_sms          VARCHAR(32)  DEFAULT NULL,
  provider_whatsapp     VARCHAR(32)  DEFAULT NULL,
  provider_call         VARCHAR(32)  DEFAULT NULL,

  -- Firebase Cloud Messaging
  firebase_project_id   TEXT DEFAULT NULL,
  firebase_client_email TEXT DEFAULT NULL,
  firebase_private_key  TEXT DEFAULT NULL,

  -- OneSignal
  onesignal_app_id      TEXT DEFAULT NULL,
  onesignal_api_key     TEXT DEFAULT NULL,

  -- Resend (Email)
  resend_api_key        TEXT DEFAULT NULL,
  resend_from_email     TEXT DEFAULT NULL,

  -- Twilio (SMS)
  twilio_account_sid    TEXT DEFAULT NULL,
  twilio_auth_token     TEXT DEFAULT NULL,
  twilio_from_number    TEXT DEFAULT NULL,

  -- MSG91 (SMS/Email/WhatsApp/Call)
  msg91_auth_key        TEXT DEFAULT NULL,
  msg91_whatsapp_number TEXT DEFAULT NULL,
  msg91_flow_base_url   TEXT DEFAULT NULL,
  msg91_sms_flow_id     TEXT DEFAULT NULL,
  msg91_email_flow_id   TEXT DEFAULT NULL,
  msg91_call_flow_id    TEXT DEFAULT NULL,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS provider_whatsapp VARCHAR(32) DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS provider_call VARCHAR(32) DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS twilio_from_number TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_auth_key TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_whatsapp_number TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_flow_base_url TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_sms_flow_id TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_email_flow_id TEXT DEFAULT NULL;
ALTER TABLE app_provider_credentials
  ADD COLUMN IF NOT EXISTS msg91_call_flow_id TEXT DEFAULT NULL;

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_push;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_push
  CHECK (provider_push IS NULL OR provider_push IN ('firebase', 'onesignal'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_email;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_email
  CHECK (provider_email IS NULL OR provider_email IN ('resend', 'onesignal', 'msg91'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_sms;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_sms
  CHECK (provider_sms IS NULL OR provider_sms IN ('onesignal', 'twilio', 'msg91'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_whatsapp;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_whatsapp
  CHECK (provider_whatsapp IS NULL OR provider_whatsapp IN ('meta', 'msg91'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_call;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_call
  CHECK (provider_call IS NULL OR provider_call IN ('msg91'));

-- =============================================
-- 7. Scheduled Notifications System
-- =============================================

-- 7a. Global application settings
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_settings (key, value, description)
VALUES
  ('schedule_poll_interval_cron', '*/2 * * * *', 'How often the scheduler polls for due notifications'),
  ('schedule_max_retries', '3', 'Default max retries for data_source_url failures'),
  ('schedule_default_timezone', 'UTC', 'Default timezone for scheduled notifications')
ON CONFLICT (key) DO NOTHING;

-- 7b. Per-client schedule settings
CREATE TABLE IF NOT EXISTS client_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        TEXT NOT NULL UNIQUE,
  max_retries      INT,
  default_timezone TEXT,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_settings_client_id
  ON client_settings (client_id);

-- 7c. Scheduled notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         TEXT NOT NULL,
  created_by        TEXT,
  type              TEXT NOT NULL,
  template_key      TEXT NOT NULL,
  data_source_url   TEXT NOT NULL,
  data_source_secret TEXT NOT NULL,
  audience          JSONB NOT NULL,
  frequency         TEXT,
  cron_expression   TEXT,
  day_of_month      INT,
  day_of_week       INT,
  time_of_day       TIME,
  timezone          TEXT,
  run_at            TIMESTAMPTZ,
  next_run_at       TIMESTAMPTZ NOT NULL,
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT,
  retry_count       INT DEFAULT 0,
  max_retries       INT,
  status            TEXT DEFAULT 'active',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_schedule_type
    CHECK (type IN ('one_time', 'recurring')),
  CONSTRAINT chk_schedule_status
    CHECK (status IN ('active', 'paused', 'completed', 'failed')),
  CONSTRAINT chk_schedule_frequency
    CHECK (frequency IS NULL OR frequency IN ('daily', 'weekly', 'monthly', 'custom_cron')),
  CONSTRAINT chk_schedule_day_of_month
    CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
  CONSTRAINT chk_schedule_day_of_week
    CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  CONSTRAINT chk_schedule_last_run_status
    CHECK (last_run_status IS NULL OR last_run_status IN ('success', 'failed', 'partial'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_poll
  ON scheduled_notifications (status, next_run_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_client
  ON scheduled_notifications (client_id, status);

-- 7d. Schedule execution logs
CREATE TABLE IF NOT EXISTS schedule_execution_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      UUID REFERENCES scheduled_notifications(id) ON DELETE CASCADE,
  client_id        TEXT,
  triggered_at     TIMESTAMPTZ DEFAULT now(),
  triggered_by     TEXT DEFAULT 'scheduler',
  status           TEXT,
  total_recipients INT DEFAULT 0,
  success_count    INT DEFAULT 0,
  fail_count       INT DEFAULT 0,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_execution_logs_schedule
  ON schedule_execution_logs (schedule_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_execution_logs_client
  ON schedule_execution_logs (client_id, triggered_at DESC);

-- =============================================
-- 8. Audiences (named user segments)
-- =============================================

CREATE TABLE IF NOT EXISTS audiences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL REFERENCES apps(app_id),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  members     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, name)
);

CREATE INDEX IF NOT EXISTS idx_audiences_app_id
  ON audiences (app_id, created_at DESC);

