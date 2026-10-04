-- =============================================
-- BlueMQ - Explicit app-scoped WhatsApp fallback
-- =============================================
-- Only one active or inactive session may be designated as the fallback for
-- an app. Resolution still requires the session to be active and Meta-based.

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_one_fallback_per_app
  ON whatsapp_sessions (app_id)
  WHERE is_fallback = true;

COMMENT ON COLUMN whatsapp_sessions.is_fallback IS
  'Explicit app-scoped fallback session used after entity hierarchy resolution';