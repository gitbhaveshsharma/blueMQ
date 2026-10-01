-- Migration 018: Quota system, entity-parent guard, webhook infrastructure
--
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- Safe to re-run; follows the conventions of migrations 004-017.
--
-- Phase (a): adds columns to notifications, entity_parent_map, and all quota tables.
-- Phase (b): app_webhooks, webhook_deliveries.
-- app_settings seeds for quota_timezone and stale-reservation timeout.

-- ── notifications: additive columns ──────────────────────────────────────────

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS parent_entity_id VARCHAR(255) DEFAULT NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS expected_channels TEXT[] DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_parent_entity
  ON notifications (app_id, parent_entity_id, created_at DESC)
  WHERE parent_entity_id IS NOT NULL;

-- ── entity_parent_map ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_parent_map (
  app_id           VARCHAR(64)  NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  entity_id        VARCHAR(255) NOT NULL,
  parent_entity_id VARCHAR(255) NOT NULL,
  first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, entity_id)
);

-- ── quota_profiles ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quota_profiles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id     VARCHAR(64) NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  is_default BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_profiles_one_default
  ON quota_profiles (app_id)
  WHERE is_default = true;

-- ── quota_profile_limits ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quota_profile_limits (
  profile_id  UUID        NOT NULL REFERENCES quota_profiles(id) ON DELETE CASCADE,
  channel     VARCHAR(32) NOT NULL,
  limit_count INT         NOT NULL CHECK (limit_count >= 0),
  period      VARCHAR(16) NOT NULL CHECK (period IN ('daily', 'monthly')),
  PRIMARY KEY (profile_id, channel)
);

-- ── owner_quota ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_quota (
  app_id     VARCHAR(64)  NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  owner_id   VARCHAR(255) NOT NULL,
  profile_id UUID         REFERENCES quota_profiles(id) ON DELETE SET NULL,
  overrides  JSONB        NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, owner_id)
);

-- ── quota_usage ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quota_usage (
  app_id       VARCHAR(64)  NOT NULL,
  owner_id     VARCHAR(255) NOT NULL,
  channel      VARCHAR(32)  NOT NULL,
  period_start DATE         NOT NULL,
  used         INT          NOT NULL DEFAULT 0,
  reserved     INT          NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, owner_id, channel, period_start),
  CONSTRAINT chk_quota_usage_non_negative CHECK (used >= 0 AND reserved >= 0)
);

CREATE INDEX IF NOT EXISTS idx_quota_usage_owner
  ON quota_usage (app_id, owner_id, channel);

-- ── quota_reservations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quota_reservations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID         NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  app_id          VARCHAR(64)  NOT NULL,
  owner_id        VARCHAR(255) NOT NULL,
  entity_id       VARCHAR(255),
  channel         VARCHAR(32)  NOT NULL,
  units           INT          NOT NULL DEFAULT 1,
  period_start    DATE         NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'reserved'
                  CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_stale
  ON quota_reservations (created_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_quota_reservations_owner
  ON quota_reservations (app_id, owner_id, entity_id, channel, period_start);

-- ── quota_threshold_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quota_threshold_events (
  app_id       VARCHAR(64)  NOT NULL,
  owner_id     VARCHAR(255) NOT NULL,
  channel      VARCHAR(32)  NOT NULL,
  period_start DATE         NOT NULL,
  threshold    INT          NOT NULL,
  fired_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, owner_id, channel, period_start, threshold)
);

-- ── app_webhooks ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_webhooks (
  app_id     VARCHAR(64) PRIMARY KEY REFERENCES apps(app_id) ON DELETE CASCADE,
  url        TEXT        NOT NULL,
  secret     TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  events     TEXT[]      NOT NULL DEFAULT ARRAY['notification.final', 'quota.threshold'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── webhook_deliveries ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          VARCHAR(64) NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  event_id        UUID        NOT NULL,
  event_type      VARCHAR(64) NOT NULL,
  notification_id UUID        REFERENCES notifications(id) ON DELETE SET NULL,
  payload         JSONB       NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        INT         NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_poll
  ON webhook_deliveries (status, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_app
  ON webhook_deliveries (app_id, created_at DESC);

-- ── app_settings: quota keys ──────────────────────────────────────────────────

INSERT INTO app_settings (key, value, description)
VALUES
  ('quota_timezone',
   'Asia/Kolkata',
   'IANA timezone for computing quota period_start (daily = current date, monthly = first of month)'),
  ('quota_stale_reservation_timeout_minutes',
   '60',
   'Minutes after which a stuck ''reserved'' reservation is released (notification must be in final state)')
ON CONFLICT (key) DO NOTHING;
