-- =============================================
-- Migration 012: Scheduled Notifications System
-- =============================================
-- Adds support for one-time and recurring scheduled notifications.
-- BlueMQ fetches fresh payloads from client data_source_url at
-- execution time, keeping business logic in the client app.

-- 1. Global application settings (managed by BlueMQ admin)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed default values (no-op if already present)
INSERT INTO app_settings (key, value, description)
VALUES
  ('schedule_poll_interval_cron', '*/2 * * * *', 'How often the scheduler polls for due notifications'),
  ('schedule_max_retries', '3', 'Default max retries for data_source_url failures'),
  ('schedule_default_timezone', 'UTC', 'Default timezone for scheduled notifications')
ON CONFLICT (key) DO NOTHING;

-- 2. Per-client schedule settings (overrides global defaults)
CREATE TABLE IF NOT EXISTS client_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        TEXT NOT NULL UNIQUE,
  max_retries      INT,
  default_timezone TEXT,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_settings_client_id
  ON client_settings (client_id);

-- 3. Scheduled notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         TEXT NOT NULL,
  created_by        TEXT,
  type              TEXT NOT NULL,
  template_key      TEXT NOT NULL,
  data_source_url   TEXT NOT NULL,
  data_source_secret TEXT NOT NULL,
  audience          JSONB NOT NULL,
  frequency         TEXT,
  cron_expression   TEXT,
  day_of_month      INT,
  day_of_week       INT,
  time_of_day       TIME,
  timezone          TEXT,
  run_at            TIMESTAMPTZ,
  next_run_at       TIMESTAMPTZ NOT NULL,
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT,
  retry_count       INT DEFAULT 0,
  max_retries       INT,
  status            TEXT DEFAULT 'active',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_schedule_type
    CHECK (type IN ('one_time', 'recurring')),

  CONSTRAINT chk_schedule_status
    CHECK (status IN ('active', 'paused', 'completed', 'failed')),

  CONSTRAINT chk_schedule_frequency
    CHECK (frequency IS NULL OR frequency IN ('daily', 'weekly', 'monthly', 'custom_cron')),

  CONSTRAINT chk_schedule_day_of_month
    CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),

  CONSTRAINT chk_schedule_day_of_week
    CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),

  CONSTRAINT chk_schedule_last_run_status
    CHECK (last_run_status IS NULL OR last_run_status IN ('success', 'failed', 'partial'))
);

-- Polling query: find active schedules that are due
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_poll
  ON scheduled_notifications (status, next_run_at)
  WHERE status = 'active';

-- Client-scoped listing
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_client
  ON scheduled_notifications (client_id, status);

-- 4. Schedule execution logs
CREATE TABLE IF NOT EXISTS schedule_execution_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      UUID REFERENCES scheduled_notifications(id) ON DELETE CASCADE,
  client_id        TEXT,
  triggered_at     TIMESTAMPTZ DEFAULT now(),
  triggered_by     TEXT DEFAULT 'scheduler',
  status           TEXT,
  total_recipients INT DEFAULT 0,
  success_count    INT DEFAULT 0,
  fail_count       INT DEFAULT 0,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_execution_logs_schedule
  ON schedule_execution_logs (schedule_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_execution_logs_client
  ON schedule_execution_logs (client_id, triggered_at DESC);

-- RETENTION POLICY: rows older than 90 days should be purged.
-- Recommended: add a BullMQ repeatable job that runs weekly and
-- executes: DELETE FROM schedule_execution_logs
--            WHERE triggered_at < now() - INTERVAL '90 days'
-- This keeps the table from growing unbounded in production.
