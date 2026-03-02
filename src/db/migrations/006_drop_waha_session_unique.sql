-- WAHA Core only supports one session named "default".
-- All entities share the same WAHA session name, so the
-- UNIQUE constraint on waha_session always blocks a second entity.
-- Drop it — ownership is already enforced by UNIQUE(app_id, entity_id).
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_waha_session_key;
