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
  cta_text    VARCHAR(255),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, type, channel)
);

-- Normalize legacy inapp alias to canonical in_app, preserving the latest row.
UPDATE templates AS canonical
SET
  title = legacy.title,
  body = legacy.body,
  cta_text = legacy.cta_text,
  is_active = legacy.is_active,
  updated_at = legacy.updated_at
FROM templates AS legacy
WHERE canonical.app_id = legacy.app_id
  AND canonical.type = legacy.type
  AND canonical.channel = 'in_app'
  AND legacy.channel = 'inapp'
  AND legacy.updated_at > canonical.updated_at;

DELETE FROM templates AS legacy
USING templates AS canonical
WHERE legacy.app_id = canonical.app_id
  AND legacy.type = canonical.type
  AND legacy.channel = 'inapp'
  AND canonical.channel = 'in_app';

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
-- which provider to use per channel (push, email, sms).
-- Falls back to server-level .env credentials if not configured.
CREATE TABLE IF NOT EXISTS app_provider_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                VARCHAR(64) NOT NULL UNIQUE REFERENCES apps(app_id),

  -- Provider Routing (which provider per channel)
  provider_push         VARCHAR(32)  DEFAULT NULL,
  provider_email        VARCHAR(32)  DEFAULT NULL,
  provider_sms          VARCHAR(32)  DEFAULT NULL,

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

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_push;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_push
  CHECK (provider_push IS NULL OR provider_push IN ('firebase', 'onesignal'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_email;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_email
  CHECK (provider_email IS NULL OR provider_email IN ('resend', 'onesignal'));

ALTER TABLE app_provider_credentials
  DROP CONSTRAINT IF EXISTS chk_provider_sms;
ALTER TABLE app_provider_credentials
  ADD CONSTRAINT chk_provider_sms
  CHECK (provider_sms IS NULL OR provider_sms IN ('onesignal'));

