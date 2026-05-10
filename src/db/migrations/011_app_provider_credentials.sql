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
  provider_email        VARCHAR(32)  DEFAULT NULL,   -- 'resend' | 'onesignal' | 'msg91' | null
  provider_sms          VARCHAR(32)  DEFAULT NULL,   -- 'onesignal' | 'twilio' | 'msg91' | null
  provider_whatsapp     VARCHAR(32)  DEFAULT NULL,   -- 'meta' | 'msg91' | null
  provider_call         VARCHAR(32)  DEFAULT NULL,   -- 'msg91' | null

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

  -- ─── Twilio (SMS) ───
  twilio_account_sid    TEXT DEFAULT NULL,
  twilio_auth_token     TEXT DEFAULT NULL,
  twilio_from_number    TEXT DEFAULT NULL,

  -- ─── MSG91 (SMS/Email/WhatsApp/Call) ───
  msg91_auth_key        TEXT DEFAULT NULL,
  msg91_whatsapp_number TEXT DEFAULT NULL,
  msg91_flow_base_url   TEXT DEFAULT NULL,
  msg91_sms_flow_id     TEXT DEFAULT NULL,
  msg91_email_flow_id   TEXT DEFAULT NULL,
  msg91_call_flow_id    TEXT DEFAULT NULL,

  -- ─── Timestamps ───
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
