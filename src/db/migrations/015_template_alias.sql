-- =============================================
-- 015: App/channel-scoped template aliases
-- =============================================

CREATE TABLE IF NOT EXISTS template_alias (
  id                BIGSERIAL PRIMARY KEY,
  app_id            VARCHAR(64) NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  channel           VARCHAR(32) NOT NULL,
  entity_id         VARCHAR(255) NOT NULL DEFAULT '',
  notification_type TEXT NOT NULL,
  resolves_to       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, channel, entity_id, notification_type),
  CHECK (notification_type <> resolves_to)
);

CREATE INDEX IF NOT EXISTS idx_template_alias_lookup
  ON template_alias (app_id, channel, entity_id, notification_type);

-- Seed the requested upgrade only where the v2 Meta template actually exists.
-- This avoids hard-coding an app or WhatsApp entity into the application.
INSERT INTO template_alias
  (app_id, channel, entity_id, notification_type, resolves_to)
SELECT DISTINCT
  app_id, 'whatsapp', entity_id,
  'coaching_profile_live', 'coaching_profile_live_v2'
FROM whatsapp_meta_templates
WHERE name = 'coaching_profile_live_v2'
ON CONFLICT (app_id, channel, entity_id, notification_type) DO NOTHING;
