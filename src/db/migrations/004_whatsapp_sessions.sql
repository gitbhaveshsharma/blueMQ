-- =============================================
-- BlueMQ — WhatsApp Sessions (WAHA)
-- One session per coaching center / entity
-- =============================================

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          VARCHAR(64)  NOT NULL REFERENCES apps(app_id),
  entity_id       VARCHAR(255) NOT NULL,
  waha_session    VARCHAR(255) NOT NULL UNIQUE,
  phone_number    VARCHAR(20),
  status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
  qr_code         TEXT,
  connected_at    TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (app_id, entity_id)
);

-- Fast lookup for active sessions during message sending
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_lookup
  ON whatsapp_sessions (app_id, entity_id)
  WHERE status = 'active';
