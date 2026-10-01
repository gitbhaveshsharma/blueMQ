"use strict";

/**
 * Quota stale-reservation cleanup worker.
 *
 * Runs every 5 minutes. Releases quota_reservations that:
 *   - are still in 'reserved' status
 *   - have been reserved longer than quota_stale_reservation_timeout_minutes
 *   - belong to a notification in a final state (delivered, partial, failed)
 *
 * This is a safety net for cases where:
 *   - A worker crashed between enqueue and settlement
 *   - The BullMQ job was lost (Redis eviction)
 *   - An enqueue rollback failed to clean up the reservation
 *
 * The worker uses FOR UPDATE SKIP LOCKED to be safe for concurrent deployments.
 */

const { getDb } = require("../db");
const { releaseStaleReservations } = require("../utils/quota");

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _timer = null;
let _running = false;

async function tick() {
  if (_running) return; // prevent overlapping runs
  _running = true;
  try {
    const sql = getDb();
    const released = await releaseStaleReservations(sql);
    if (released > 0) {
      console.log(`[quota-stale] Released ${released} stale reservation(s)`);
    }
  } catch (err) {
    console.error("[quota-stale] Error during stale reservation cleanup:", err.message);
  } finally {
    _running = false;
  }
}

function start() {
  if (_timer) return; // already started
  console.log("[quota-stale] Stale reservation cleanup worker started (interval=5m)");
  // Run once immediately on start, then on interval
  tick().catch((err) => console.error("[quota-stale] Initial tick error:", err.message));
  _timer = setInterval(tick, POLL_INTERVAL_MS);
  // Allow the process to exit even if the timer is still active
  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop };
