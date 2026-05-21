const crypto = require("crypto");

/**
 * Generate an HMAC-SHA256 hex signature for the given payload.
 *
 * Used by BlueMQ to sign outbound requests to a client's data_source_url
 * so the client can verify the call originated from BlueMQ.
 *
 * @param {string} secret  — the per-schedule data_source_secret
 * @param {string} payload — the JSON-stringified request body
 * @returns {string} hex-encoded HMAC-SHA256 signature
 */
function signRequest(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature using timing-safe comparison.
 *
 * Clients can copy this logic to verify that an incoming request
 * was genuinely signed by BlueMQ.
 *
 * @param {string} secret    — the shared secret
 * @param {string} payload   — the raw request body string
 * @param {string} signature — the signature from x-bluemq-signature header (without "sha256=" prefix)
 * @returns {boolean}
 */
function verifyRequest(secret, payload, signature) {
  const expected = signRequest(secret, payload);

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

module.exports = { signRequest, verifyRequest };
