-- =============================================
-- 014: WhatsApp Meta template cache
-- =============================================

CREATE TABLE IF NOT EXISTS whatsapp_meta_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id             VARCHAR(64) NOT NULL REFERENCES apps(app_id),
  entity_id          VARCHAR(255) NOT NULL,
  meta_id            VARCHAR(64),
  name               VARCHAR(512) NOT NULL,
  language           VARCHAR(32) NOT NULL,
  status             VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  category           VARCHAR(32),
  components         JSONB NOT NULL DEFAULT '[]',
  last_updated_time  TIMESTAMPTZ,
  cached_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, entity_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_templates_lookup
  ON whatsapp_meta_templates (app_id, entity_id, name, status);
