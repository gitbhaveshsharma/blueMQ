-- Migration 019: owner_quota.label column + missing performance indexes
--
-- Additive only. Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ── owner_quota: add optional label for display name ──────────────────────────

ALTER TABLE owner_quota
  ADD COLUMN IF NOT EXISTS label VARCHAR(255) DEFAULT NULL;

-- ── notifications: index on entity_id for owner-scoped queries ────────────────
-- (parent_entity_id index was already added in 018; this covers the entity_id fallback)

CREATE INDEX IF NOT EXISTS idx_notifications_entity_id
  ON notifications (app_id, entity_id, created_at DESC);

-- ── notification_logs: index on notification_id for join performance ───────────

CREATE INDEX IF NOT EXISTS idx_notification_logs_notification_id
  ON notification_logs (notification_id);

-- ── quota_reservations: index for branch breakdown query ──────────────────────
-- already exists from 018: idx_quota_reservations_owner
-- just confirm; this is a no-op if it exists
CREATE INDEX IF NOT EXISTS idx_quota_reservations_owner
  ON quota_reservations (app_id, owner_id, entity_id, channel, period_start);
