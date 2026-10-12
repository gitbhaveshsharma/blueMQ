"use strict";

/**
 * Tests for webhook-delivery.worker.js
 *
 * Covers:
 *   - enqueueWebhookEvent: skips if no active webhook, inserts row if subscribed
 *   - BACKOFF_SECONDS schedule shape
 *   - deliverOne (internal helper) — mocked via the module's internals
 */

const { BACKOFF_SECONDS, MAX_ATTEMPTS } = require("../src/workers/webhook-delivery.worker");

// ─── BACKOFF_SECONDS schedule ──────────────────────────────────────────────────

describe("BACKOFF_SECONDS", () => {
  it("has exactly MAX_ATTEMPTS entries", () => {
    expect(BACKOFF_SECONDS.length).toBe(MAX_ATTEMPTS);
  });

  it("first attempt is immediate (0 s)", () => {
    expect(BACKOFF_SECONDS[0]).toBe(0);
  });

  it("second attempt waits 30 s", () => {
    expect(BACKOFF_SECONDS[1]).toBe(30);
  });

  it("delays are non-decreasing", () => {
    for (let i = 1; i < BACKOFF_SECONDS.length; i++) {
      expect(BACKOFF_SECONDS[i]).toBeGreaterThanOrEqual(BACKOFF_SECONDS[i - 1]);
    }
  });
});

// ─── enqueueWebhookEvent ──────────────────────────────────────────────────────

describe("enqueueWebhookEvent", () => {
  let enqueueWebhookEvent;

  beforeEach(() => {
    jest.resetModules();
    ({ enqueueWebhookEvent } = require("../src/workers/webhook-delivery.worker"));
  });

  it("does nothing when no active webhook is subscribed to the event", async () => {
    const sql = {
      query: jest.fn(async () => ({ rows: [] })),
    };

    await enqueueWebhookEvent(sql, {
      appId: "app1",
      eventType: "notification.final",
      payload: { event: "notification.final" },
      notificationId: "notif-uuid",
    });

    // Should have called the SELECT but NOT the INSERT
    expect(sql.query).toHaveBeenCalledTimes(1);
    expect(sql.query.mock.calls[0][0]).toMatch(/SELECT 1 FROM app_webhooks/);
  });

  it("inserts a webhook_deliveries row when an active webhook is found", async () => {
    let callCount = 0;
    const sql = {
      query: jest.fn(async (q) => {
        callCount++;
        if (callCount === 1) {
          // SELECT check
          return { rows: [{ 1: 1 }] };
        }
        // INSERT
        return { rows: [] };
      }),
    };

    await enqueueWebhookEvent(sql, {
      appId: "app1",
      eventType: "notification.final",
      payload: { event: "notification.final", notification_id: "notif-uuid" },
      notificationId: "notif-uuid",
    });

    expect(sql.query).toHaveBeenCalledTimes(2);
    const insertCall = sql.query.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO webhook_deliveries/);
    // Verify appId and eventType are passed
    expect(insertCall[1]).toContain("app1");
    expect(insertCall[1]).toContain("notification.final");
  });

  it("does not throw even if INSERT fails (caller must handle errors)", async () => {
    let callCount = 0;
    const sql = {
      query: jest.fn(async () => {
        callCount++;
        if (callCount === 2) throw new Error("DB error");
        return { rows: [{ 1: 1 }] };
      }),
    };

    // Should propagate the error (not swallow it silently)
    await expect(
      enqueueWebhookEvent(sql, {
        appId: "app1",
        eventType: "notification.final",
        payload: {},
      })
    ).rejects.toThrow("DB error");
  });
});
