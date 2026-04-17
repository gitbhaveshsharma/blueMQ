-- =============================================
-- BlueMQ — Meta-only WhatsApp sessions
-- =============================================
-- Purpose:
--   1) Enforce Meta Cloud API as the only supported WhatsApp connection type
--   2) Safely migrate legacy WAHA rows so runtime stays stable
--
-- Run:
--   psql $DATABASE_URL -f src/db/migrations/009_meta_only_whatsapp.sql
-- =============================================

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) NOT NULL DEFAULT 'meta';

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_api_key TEXT DEFAULT NULL;

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(100) DEFAULT NULL;

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS meta_business_account_id VARCHAR(100) DEFAULT NULL;

ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS chk_connection_type;

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

COMMENT ON COLUMN whatsapp_sessions.connection_type IS 'Provider type: meta';
