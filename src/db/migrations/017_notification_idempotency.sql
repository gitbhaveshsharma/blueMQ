-- Migration 017: Multi-tenant notification idempotency & entity scoping
--
-- 1. Adds entity_id column to notifications (if not exists) to track
--    which coaching center / tenant created the notification.
-- 2. Adds idempotency_key column to notifications (if not exists).
-- 3. Drops any legacy single-tenant index (app_id, idempotency_key).
-- 4. Creates a multi-tenant partial unique index scoped to
--    (app_id, COALESCE(entity_id, ''), idempotency_key).
--    This guarantees that two different coaching centers under the same
--    SaaS app can never collide or block each other's notifications, even
--    if students are enrolled in both or share identical keys.
-- 5. Adds index on (app_id, entity_id, created_at DESC) for fast tenant filtering.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS entity_id VARCHAR(255) DEFAULT NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) DEFAULT NULL;

-- Drop legacy index that lacked entity_id scoping
DROP INDEX IF EXISTS idx_notifications_idempotency_key;

-- Multi-tenant unique index: enforces uniqueness per (app_id, entity_id, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_tenant_idempotency
  ON notifications (app_id, COALESCE(entity_id, ''), idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Fast lookup index for notifications by tenant / coaching center
CREATE INDEX IF NOT EXISTS idx_notifications_app_entity
  ON notifications (app_id, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;
