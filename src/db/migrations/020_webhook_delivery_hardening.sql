-- Migration 020: Hardening fixes
--
-- D1: Race-safe webhook_deliveries deduplication.
--     Multiple workers can concurrently call _maybeFireNotificationFinal.
--     Without a unique index both can INSERT a 'notification.final' row for
--     the same notification, causing duplicate webhooks to be delivered.
--     The unique index + ON CONFLICT DO NOTHING in enqueueWebhookEvent makes
--     the entire operation idempotent with no application-level locking needed.
--
-- D2: webhook_deliveries index for retry polling performance.
--
-- All statements use IF NOT EXISTS / ON CONFLICT — safe to re-run.

-- ── D1: unique dedup index on webhook_deliveries ──────────────────────────────
--
-- Scoped to (app_id, event_type, notification_id) — one final event per
-- notification per event_type. Uses COALESCE so the index covers both
-- notification-bound events (notification.final) and app-scoped events
-- (quota.threshold, which may have notification_id = NULL).
--
-- Partial index: only 'pending' and 'delivered' rows participate — failed
-- retries that were reset via the dashboard must be allowed to re-insert.

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_dedup
  ON webhook_deliveries (app_id, event_type, COALESCE(notification_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending', 'delivered');

-- ── D2: index for poll query ordering / filtering ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_poll
  ON webhook_deliveries (status, next_attempt_at ASC)
  WHERE status = 'pending';
