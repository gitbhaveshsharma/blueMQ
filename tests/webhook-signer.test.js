"use strict";

/**
 * Tests for src/utils/webhook-signer.js
 *
 * Covers:
 *   - signWebhookPayload produces consistent sha256= prefix
 *   - verifyWebhookSignature accepts valid signature
 *   - verifyWebhookSignature rejects tampered payload
 *   - verifyWebhookSignature rejects wrong secret
 *   - verifyWebhookSignature rejects malformed header
 */

const { signWebhookPayload, verifyWebhookSignature } = require("../src/utils/webhook-signer");

const SECRET = "test-secret-abc123";
const PAYLOAD = JSON.stringify({ event: "notification.final", notification_id: "uuid-1234" });

describe("signWebhookPayload", () => {
  it("returns a string starting with sha256=", () => {
    const sig = signWebhookPayload(SECRET, PAYLOAD);
    expect(typeof sig).toBe("string");
    expect(sig.startsWith("sha256=")).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const sig1 = signWebhookPayload(SECRET, PAYLOAD);
    const sig2 = signWebhookPayload(SECRET, PAYLOAD);
    expect(sig1).toBe(sig2);
  });

  it("differs when the payload differs", () => {
    const sig1 = signWebhookPayload(SECRET, PAYLOAD);
    const sig2 = signWebhookPayload(SECRET, PAYLOAD + " ");
    expect(sig1).not.toBe(sig2);
  });

  it("differs when the secret differs", () => {
    const sig1 = signWebhookPayload(SECRET, PAYLOAD);
    const sig2 = signWebhookPayload("other-secret", PAYLOAD);
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifyWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const sig = signWebhookPayload(SECRET, PAYLOAD);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, sig)).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const sig = signWebhookPayload(SECRET, PAYLOAD);
    expect(verifyWebhookSignature(SECRET, PAYLOAD + "X", sig)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = signWebhookPayload(SECRET, PAYLOAD);
    expect(verifyWebhookSignature("wrong-secret", PAYLOAD, sig)).toBe(false);
  });

  it("returns false when signature header is missing", () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, "")).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, undefined)).toBe(false);
  });

  it("returns false when sha256= prefix is absent", () => {
    const sig = signWebhookPayload(SECRET, PAYLOAD);
    const withoutPrefix = sig.replace("sha256=", "");
    expect(verifyWebhookSignature(SECRET, PAYLOAD, withoutPrefix)).toBe(false);
  });
});
