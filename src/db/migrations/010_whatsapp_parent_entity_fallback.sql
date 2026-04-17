-- =============================================
-- BlueMQ — WhatsApp parent/child fallback
-- =============================================
-- Purpose:
--   1) Store an optional parent entity for each WhatsApp session
--   2) Allow delivery to fall back from child -> parent when the child
--      entity has no active WhatsApp credentials
-- =============================================

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS parent_entity_id VARCHAR(255) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_parent_lookup
  ON whatsapp_sessions (app_id, parent_entity_id)
  WHERE status = 'active';

COMMENT ON COLUMN whatsapp_sessions.parent_entity_id IS
  'Optional parent entity used when child WhatsApp credentials inherit from a parent';
