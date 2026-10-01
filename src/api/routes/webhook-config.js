"use strict";

/**
 * Webhook configuration API.
 *
 * Routes:
 *   GET    /webhooks/config              — get this app's webhook config
 *   POST   /webhooks/config              — create or replace webhook config
 *   PATCH  /webhooks/config              — update (partial) webhook config
 *   DELETE /webhooks/config              — remove webhook config
 *   GET    /webhooks/deliveries          — list webhook_deliveries
 *   POST   /webhooks/deliveries/:id/retry — dashboard retry (reset to pending)
 *   GET    /webhooks/verify-signature    — documentation helper (returns expected header format)
 */

const { Router } = require("express");
const crypto = require("crypto");
const { getDb } = require("../../db");

const ALLOWED_EVENTS = ["notification.final", "quota.threshold"];

const router = Router();

// ─── Config CRUD ──────────────────────────────────────────────────────────────

router.get("/config", async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql.query(
      `SELECT app_id, url, is_active, events, created_at, updated_at
       FROM app_webhooks WHERE app_id = $1`,
      [req.appId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No webhook configured" });
    }
    // Never expose the secret in GET responses
    return res.json({ webhook: result.rows[0] });
  } catch (err) {
    console.error("[webhooks] GET /config error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/config", async (req, res) => {
  try {
    const { url, events, is_active = true } = req.body;

    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      return res.status(400).json({ error: "url must be a valid http/https URL" });
    }

    const resolvedEvents = Array.isArray(events)
      ? events.filter((e) => ALLOWED_EVENTS.includes(e))
      : ALLOWED_EVENTS;

    if (resolvedEvents.length === 0) {
      return res.status(400).json({
        error: `events must include at least one of: ${ALLOWED_EVENTS.join(", ")}`,
      });
    }

    // Generate a new random secret
    const secret = crypto.randomBytes(32).toString("hex");
    const sql = getDb();

    const result = await sql.query(
      `INSERT INTO app_webhooks (app_id, url, secret, is_active, events)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (app_id) DO UPDATE
         SET url = EXCLUDED.url, secret = $3, is_active = EXCLUDED.is_active,
             events = EXCLUDED.events, updated_at = now()
       RETURNING app_id, url, is_active, events, created_at, updated_at`,
      [req.appId, url, secret, Boolean(is_active), resolvedEvents]
    );

    // Return the secret ONCE on creation/rotation only
    return res.status(201).json({
      webhook: result.rows[0],
      secret,
      _note: "Store this secret securely. It is never returned again.",
    });
  } catch (err) {
    console.error("[webhooks] POST /config error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/config", async (req, res) => {
  try {
    const { url, events, is_active, rotate_secret } = req.body;
    const sql = getDb();

    const existing = await sql.query(
      `SELECT 1 FROM app_webhooks WHERE app_id = $1`,
      [req.appId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "No webhook configured. Use POST /webhooks/config first." });
    }

    const updates = ["updated_at = now()"];
    const params = [];

    if (url !== undefined) {
      if (!url.startsWith("http")) {
        return res.status(400).json({ error: "url must be a valid http/https URL" });
      }
      params.push(url);
      updates.push(`url = $${params.length}`);
    }

    if (events !== undefined) {
      const validEvents = Array.isArray(events)
        ? events.filter((e) => ALLOWED_EVENTS.includes(e))
        : [];
      if (validEvents.length === 0) {
        return res.status(400).json({ error: `events must include at least one of: ${ALLOWED_EVENTS.join(", ")}` });
      }
      params.push(validEvents);
      updates.push(`events = $${params.length}`);
    }

    if (is_active !== undefined) {
      params.push(Boolean(is_active));
      updates.push(`is_active = $${params.length}`);
    }

    let newSecret;
    if (rotate_secret === true) {
      newSecret = crypto.randomBytes(32).toString("hex");
      params.push(newSecret);
      updates.push(`secret = $${params.length}`);
    }

    params.push(req.appId);
    const result = await sql.query(
      `UPDATE app_webhooks SET ${updates.join(", ")}
       WHERE app_id = $${params.length}
       RETURNING app_id, url, is_active, events, updated_at`,
      params
    );

    const response = { webhook: result.rows[0] };
    if (newSecret) {
      response.secret = newSecret;
      response._note = "Store this secret securely. It is never returned again.";
    }

    return res.json(response);
  } catch (err) {
    console.error("[webhooks] PATCH /config error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/config", async (req, res) => {
  try {
    const sql = getDb();
    await sql.query(`DELETE FROM app_webhooks WHERE app_id = $1`, [req.appId]);
    return res.json({ deleted: true });
  } catch (err) {
    console.error("[webhooks] DELETE /config error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Deliveries ───────────────────────────────────────────────────────────────

router.get("/deliveries", async (req, res) => {
  try {
    const sql = getDb();
    const { status, event_type, limit: limitStr = "50", page: pageStr = "1" } = req.query;
    const limit = Math.min(200, Math.max(1, parseInt(limitStr, 10) || 50));
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const offset = (page - 1) * limit;

    const params = [req.appId];
    const where = ["app_id = $1"];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (event_type) {
      params.push(event_type);
      where.push(`event_type = $${params.length}`);
    }

    const countRes = await sql.query(
      `SELECT COUNT(*) FROM webhook_deliveries WHERE ${where.join(" AND ")}`,
      params
    );

    params.push(limit, offset);
    const result = await sql.query(
      `SELECT id, event_id, event_type, notification_id, status, attempts,
              next_attempt_at, last_error, created_at, delivered_at,
              payload->>'event' AS event_name
       FROM webhook_deliveries
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      deliveries: result.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error("[webhooks] GET /deliveries error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /webhooks/deliveries/:id/retry
 * Reset a failed delivery to pending so the worker picks it up again.
 */
router.post("/deliveries/:id/retry", async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql.query(
      `UPDATE webhook_deliveries
       SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
       WHERE id = $1 AND app_id = $2
       RETURNING id, status, attempts`,
      [req.params.id, req.appId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Delivery not found" });
    }

    return res.json({ delivery: result.rows[0], retrying: true });
  } catch (err) {
    console.error("[webhooks] POST /deliveries/:id/retry error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /webhooks/deliveries/:id
 * Get full payload of a single delivery.
 */
router.get("/deliveries/:id", async (req, res) => {
  try {
    const sql = getDb();
    const result = await sql.query(
      `SELECT * FROM webhook_deliveries WHERE id = $1 AND app_id = $2`,
      [req.params.id, req.appId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Delivery not found" });
    }
    return res.json({ delivery: result.rows[0] });
  } catch (err) {
    console.error("[webhooks] GET /deliveries/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
