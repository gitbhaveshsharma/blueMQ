-- Normalized audience members. The legacy audiences.members JSONB column is
-- retained during rollout so existing deployments can be rolled back safely.
CREATE TABLE IF NOT EXISTS audience_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id         UUID NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  app_id              VARCHAR(64) NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  email               TEXT,
  phone               TEXT,
  fcm_token           TEXT,
  onesignal_player_id TEXT,
  entity_id           VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audience_member_contact CHECK (
    email IS NOT NULL OR phone IS NOT NULL OR fcm_token IS NOT NULL
    OR onesignal_player_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_audience_members_page
  ON audience_members (audience_id, id);

CREATE INDEX IF NOT EXISTS idx_audience_members_app
  ON audience_members (app_id, audience_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audience_members_user
  ON audience_members (audience_id, user_id);

INSERT INTO audience_members (
  audience_id, app_id, user_id, email, phone, fcm_token,
  onesignal_player_id, entity_id
)
SELECT
  a.id,
  a.app_id,
  COALESCE(
    NULLIF(BTRIM(member->>'user_id'), ''),
    'legacy:' || md5(a.id::text || ':' || member_ordinality::text || ':' || member::text)
  ),
  NULLIF(BTRIM(member->>'email'), ''),
  NULLIF(BTRIM(member->>'phone'), ''),
  NULLIF(BTRIM(member->>'fcm_token'), ''),
  NULLIF(BTRIM(member->>'onesignal_player_id'), ''),
  NULLIF(BTRIM(member->>'entity_id'), '')
FROM audiences a
CROSS JOIN LATERAL jsonb_array_elements(a.members)
  WITH ORDINALITY AS legacy(member, member_ordinality)
WHERE jsonb_typeof(a.members) = 'array'
  AND (
    NULLIF(BTRIM(member->>'email'), '') IS NOT NULL
    OR NULLIF(BTRIM(member->>'phone'), '') IS NOT NULL
    OR NULLIF(BTRIM(member->>'fcm_token'), '') IS NOT NULL
    OR NULLIF(BTRIM(member->>'onesignal_player_id'), '') IS NOT NULL
  )
ON CONFLICT (audience_id, user_id) DO NOTHING;
