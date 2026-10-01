"use strict";

/**
 * Webhook delivery worker.
 *
 * Design (per spec):
 *  - `webhook_deliveries` is the source of truth.
 *  - Claim rows with `FOR UPDATE SKIP LOCKED` so multiple processes are safe.
 *  - Backoff schedule: 0 s, 30 s, 5 m, 30 m, 2 h (5 attempts total).
 *  - After max attempts: status = 'failed', no more retries.
 *  - Dashboard retries work by resetting next_attempt_at = now() and attempts = 0.
 *  - Starts in EVERY process that runs workers.
 *
 * This is a polling-based worker (not BullMQ) because webhook_deliveries is the
 * authoritative store and we need dashboard-initiated retries to work without
 * re-enqueueing into BullMQ.
 */

const { getDb } = require("../db");
const { signWebhookPayload } = require("../utils/webhook-signer");

// Backoff schedule (seconds after previous attempt)
// attempt 1 → 0 s wait (immediate), attempt 2 → 30 s, 3 → 5 min, 4 → 30 min, 5 → 2 h
const BACKOFF_SECONDS = [0, 30, 300, 1800, 7200];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const BATCH_SIZE = 20;
const HTTP_TIMEOUT_MS = 15_000;

let _timer = null;
let _running = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate next_attempt_at for the given attempt number (1-indexed).
 * attempt=1 → now+0s (immediate), attempt=2 → now+30s, ...
 */
function nextAttemptAt(attemptNumber) {
  const delaySeconds = BACKOFF_SECONDS[attemptNumber] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
  return new Date(Date.now() + delaySeconds * 1000);
}

/**
 * Deliver one webhook_deliveries row.
 * Returns { success: boolean, statusCode?: number, error?: string }.
 */
async function deliverOne(row) {
  const body = JSON.stringify(row.payload);
  const signature = signWebhookPayload(row._secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(row._url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-bluemq-signature": signature,
        "x-bluemq-event": row.event_type,
        "x-bluemq-delivery-id": row.id,
      },
      body,
    });

    if (res.ok) {
      return { success: true, statusCode: res.status };
    }

    const text = await res.text().catch(() => "");
    return {
      success: false,
      statusCode: res.status,
      error: `HTTP ${res.status}: ${text.substring(0, 300)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === "AbortError" ? "Request timed out" : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Main poll tick ───────────────────────────────────────────────────────────

async function tick() {
  if (_running) return;
  _running = true;
  try {
    const sql = getDb();

    // Claim a batch of pending rows whose next_attempt_at is due
    // Join app_webhooks to get url + secret + is_active in a single query.
    // Skip rows where the webhook has been deactivated (is_active = false).
    const client = await sql.raw.connect();
    let rows;
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT wd.id, wd.app_id, wd.event_id, wd.event_type,
                wd.notification_id, wd.payload, wd.attempts,
                aw.url AS _url, aw.secret AS _secret
         FROM webhook_deliveries wd
         JOIN app_webhooks aw ON aw.app_id = wd.app_id AND aw.is_active = true
         WHERE wd.status = 'pending'
           AND wd.next_attempt_at <= now()
           AND wd.event_type = ANY(aw.events)
         ORDER BY wd.next_attempt_at ASC
         LIMIT $1
         FOR UPDATE OF wd SKIP LOCKED`,
        [BATCH_SIZE]
      );
      rows = res.rows;

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return;
      }

      // Mark all claimed rows as in-flight by bumping attempts and setting
      // next_attempt_at far in the future so concurrent processes skip them.
      // We'll update properly after each attempt.
      const ids = rows.map((r) => r.id);
      await client.query(
        `UPDATE webhook_deliveries
         SET attempts = attempts + 1,
             next_attempt_at = now() + interval '1 hour'
         WHERE id = ANY($1)`,
        [ids]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Deliver each row outside the transaction (HTTP calls can be slow)
    for (const row of rows) {
      try {
        const result = await deliverOne(row);

        if (result.success) {
          await sql.query(
            `UPDATE webhook_deliveries
             SET status = 'delivered', delivered_at = now(), last_error = NULL
             WHERE id = $1`,
            [row.id]
          );
          console.log(
            `[webhook-delivery] ✅ ${row.id} (${row.event_type}) delivered`
          );
        } else {
          const newAttempts = row.attempts + 1; // already incremented above
          if (newAttempts >= MAX_ATTEMPTS) {
            await sql.query(
              `UPDATE webhook_deliveries
               SET status = 'failed', last_error = $2, next_attempt_at = now()
               WHERE id = $1`,
              [row.id, result.error || "Max attempts exceeded"]
            );
            console.warn(
              `[webhook-delivery] ❌ ${row.id} (${row.event_type}) permanently failed after ${MAX_ATTEMPTS} attempts: ${result.error}`
            );
          } else {
            const next = nextAttemptAt(newAttempts);
            await sql.query(
              `UPDATE webhook_deliveries
               SET status = 'pending', last_error = $2, next_attempt_at = $3
               WHERE id = $1`,
              [row.id, result.error || "Unknown error", next]
            );
            console.warn(
              `[webhook-delivery] ↻ ${row.id} (${row.event_type}) attempt ${newAttempts} failed, retry at ${next.toISOString()}: ${result.error}`
            );
          }
        }
      } catch (err) {
        // Unexpected error for this row — put it back to pending with backoff
        try {
          const newAttempts = row.attempts + 1;
          const next = nextAttemptAt(newAttempts);
          await sql.query(
            `UPDATE webhook_deliveries
             SET status = 'pending', last_error = $2, next_attempt_at = $3
             WHERE id = $1`,
            [row.id, err.message, next]
          );
        } catch (_) {
          /* best-effort */
        }
        console.error(
          `[webhook-delivery] Error processing row ${row.id}:`,
          err.message
        );
      }
    }
  } catch (err) {
    console.error("[webhook-delivery] Poll error:", err.message);
  } finally {
    _running = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function start() {
  if (_timer) return;
  console.log(
    `[webhook-delivery] Worker started (poll=${POLL_INTERVAL_MS / 1000}s, maxAttempts=${MAX_ATTEMPTS})`
  );
  tick().catch((err) =>
    console.error("[webhook-delivery] Initial tick error:", err.message)
  );
  _timer = setInterval(tick, POLL_INTERVAL_MS);
  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/**
 * Enqueue a webhook event into webhook_deliveries.
 * Called after a notification reaches a final state or a quota threshold fires.
 *
 * @param {object} sql
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.eventType    - e.g. 'notification.final', 'quota.threshold'
 * @param {object} opts.payload      - the event payload (will be stored as JSONB)
 * @param {string} [opts.notificationId]
 */
async function enqueueWebhookEvent(sql, { appId, eventType, payload, notificationId }) {
  // Check if the app has an active webhook subscribed to this event
  const webhookRes = await sql.query(
    `SELECT 1 FROM app_webhooks
     WHERE app_id = $1 AND is_active = true AND $2 = ANY(events)
     LIMIT 1`,
    [appId, eventType]
  );
  if (webhookRes.rows.length === 0) return; // no webhook registered for this event

  const eventId = require("crypto").randomUUID();
  await sql.query(
    `INSERT INTO webhook_deliveries
       (app_id, event_id, event_type, notification_id, payload, status, attempts, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 0, now())`,
    [
      appId,
      eventId,
      eventType,
      notificationId || null,
      JSON.stringify(payload),
    ]
  );
}

module.exports = { start, stop, enqueueWebhookEvent, MAX_ATTEMPTS, BACKOFF_SECONDS };
