-- =============================================
-- BlueMQ — Multi-session support
-- Each entity now gets its own named WAHA session
-- derived from app_id + entity_id.
-- =============================================

-- Remove the DEFAULT 'default' so new rows must specify a session name.
ALTER TABLE whatsapp_sessions ALTER COLUMN waha_session DROP DEFAULT;

-- Add an index on waha_session for fast webhook lookups.
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_waha
  ON whatsapp_sessions (waha_session);
