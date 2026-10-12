"use strict";

/**
 * Webhook signer — sign and verify outbound webhook payloads.
 *
 * Format: `sha256=<hex-hmac-sha256>` in the `x-bluemq-signature` header.
 * Identical to the GitHub Webhooks signature scheme so clients can reuse
 * battle-tested verification libraries.
 */

const crypto = require("crypto");

/**
 * Sign a JSON payload with the given secret.
 *
 * @param {string} secret   - per-webhook secret stored in app_webhooks.secret
 * @param {string} payload  - JSON-stringified event body
 * @returns {string}        - header value, e.g. "sha256=<hex>"
 */
function signWebhookPayload(secret, payload) {
  const hmac = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

/**
 * Verify a webhook signature from an incoming header.
 *
 * @param {string} secret     - the per-webhook secret
 * @param {string} payload    - the raw request body string
 * @param {string} signature  - the value of `x-bluemq-signature` header
 * @returns {boolean}
 */
function verifyWebhookSignature(secret, payload, signature) {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = signWebhookPayload(secret, payload);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

module.exports = { signWebhookPayload, verifyWebhookSignature };
