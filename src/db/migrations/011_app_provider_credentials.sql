-- =============================================
-- 011: Per-app provider credentials & routing
-- =============================================
-- Each app (client) can store their own provider credentials
-- and choose which provider to use for each channel.
-- Falls back to server-level .env credentials if not set.

CREATE TABLE IF NOT EXISTS app_provider_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                VARCHAR(64) NOT NULL UNIQUE REFERENCES apps(app_id),

  -- ─── Provider Routing (which provider per channel) ───
  provider_push         VARCHAR(32)  DEFAULT NULL,   -- 'firebase' | 'onesignal' | null (use server default)
  provider_email        VARCHAR(32)  DEFAULT NULL,   -- 'resend'   | 'onesignal' | null
  provider_sms          VARCHAR(32)  DEFAULT NULL,   -- 'onesignal' | null

  -- ─── Firebase Cloud Messaging ───
  firebase_project_id   TEXT DEFAULT NULL,
  firebase_client_email TEXT DEFAULT NULL,
  firebase_private_key  TEXT DEFAULT NULL,

  -- ─── OneSignal ───
  onesignal_app_id      TEXT DEFAULT NULL,
  onesignal_api_key     TEXT DEFAULT NULL,

  -- ─── Resend (Email) ───
  resend_api_key        TEXT DEFAULT NULL,
  resend_from_email     TEXT DEFAULT NULL,

  -- ─── Timestamps ───
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints for valid provider values
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
