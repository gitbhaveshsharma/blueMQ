"use strict";

/**
 * Tests for base.worker._maybeFireNotificationFinal
 *
 * Verifies that `notification.final` is enqueued ONLY when all expected
 * channels have a terminal log entry, and not before.
 */

// We must mock webhook-delivery.worker to avoid side effects
jest.mock("../src/workers/webhook-delivery.worker", () => ({
  enqueueWebhookEvent: jest.fn().mockResolvedValue(undefined),
  start: jest.fn(),
  stop: jest.fn(),
  MAX_ATTEMPTS: 5,
  BACKOFF_SECONDS: [0, 30, 300, 1800, 7200],
}));

// Mock other heavy dependencies
jest.mock("bullmq", () => ({ Worker: jest.fn(() => ({ on: jest.fn() })) }));
jest.mock("../src/queues/connection", () => ({ getRedisConnection: jest.fn() }));
jest.mock("../src/providers/registry", () => ({ registry: {} }));
jest.mock("../src/providers/per-app-factory", () => ({ getAppProvider: jest.fn() }));
jest.mock("../src/db", () => ({ getDb: jest.fn() }));
jest.mock("../src/config", () => ({
  queues: { push: "push-q", email: "email-q", sms: "sms-q", whatsapp: "wa-q", call: "call-q", inapp: "inapp-q" },
  workers: {
    push: { concurrency: 1, retries: 3 },
    email: { concurrency: 1, retries: 3 },
    sms: { concurrency: 1, retries: 5 },
    whatsapp: { concurrency: 1, retries: 5 },
    call: { concurrency: 1, retries: 5 },
    inapp: { concurrency: 1, retries: 2 },
  },
}));
jest.mock("../src/utils/quota", () => ({ settleOnClient: jest.fn().mockResolvedValue(undefined) }));

const { _maybeFireNotificationFinal } = require("../src/workers/base.worker");
const { enqueueWebhookEvent } = require("../src/workers/webhook-delivery.worker");

function makeSql(settledChannels) {
  return {
    query: jest.fn(async () => ({
      rows: settledChannels.map((ch) => ({ channel: ch })),
    })),
  };
}

const NOTIF_ROW = {
  app_id: "app1",
  status: "delivered",
  expected_channels: ["push", "email"],
  entity_id: "entity-1",
  parent_entity_id: "parent-1",
  external_user_id: "user-1",
  type: "fee_due",
};

describe("_maybeFireNotificationFinal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when notifRow has no app_id", async () => {
    await _maybeFireNotificationFinal(makeSql([]), "notif-1", { ...NOTIF_ROW, app_id: undefined });
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("does nothing when expected_channels is empty", async () => {
    await _maybeFireNotificationFinal(makeSql([]), "notif-1", { ...NOTIF_ROW, expected_channels: [] });
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("does not fire when only some channels are settled", async () => {
    // Only push settled, email not yet
    const sql = makeSql(["push"]);
    await _maybeFireNotificationFinal(sql, "notif-1", NOTIF_ROW);
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("fires notification.final when ALL expected channels are settled", async () => {
    const sql = makeSql(["push", "email"]);
    await _maybeFireNotificationFinal(sql, "notif-1", NOTIF_ROW);

    expect(enqueueWebhookEvent).toHaveBeenCalledTimes(1);
    const call = enqueueWebhookEvent.mock.calls[0];
    expect(call[1].appId).toBe("app1");
    expect(call[1].eventType).toBe("notification.final");
    expect(call[1].notificationId).toBe("notif-1");
    expect(call[1].payload.event).toBe("notification.final");
    expect(call[1].payload.expected_channels).toEqual(["push", "email"]);
  });

  it("fires notification.final even when one channel failed (terminal = settled)", async () => {
    // email failed = still a terminal status, should appear in settledChannels
    const sql = makeSql(["push", "email"]);
    await _maybeFireNotificationFinal(sql, "notif-2", {
      ...NOTIF_ROW,
      status: "partial",
    });
    expect(enqueueWebhookEvent).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookEvent.mock.calls[0][1].payload.status).toBe("partial");
  });

  it("includes settled_channels in the payload", async () => {
    const sql = makeSql(["push", "email"]);
    await _maybeFireNotificationFinal(sql, "notif-3", NOTIF_ROW);
    const payload = enqueueWebhookEvent.mock.calls[0][1].payload;
    expect(payload.settled_channels).toContain("push");
    expect(payload.settled_channels).toContain("email");
  });
});
