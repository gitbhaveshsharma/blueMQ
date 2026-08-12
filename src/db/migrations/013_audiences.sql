-- =============================================
-- 013: Audiences (named user segments)
-- =============================================

CREATE TABLE IF NOT EXISTS audiences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      VARCHAR(64) NOT NULL REFERENCES apps(app_id),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  -- members is a JSONB array of user objects:
  -- [{ name, email, phone, user_id, onesignal_player_id, fcm_token }]
  members     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, name)
);

CREATE INDEX IF NOT EXISTS idx_audiences_app_id
  ON audiences (app_id, created_at DESC);
