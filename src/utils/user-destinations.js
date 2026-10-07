"use strict";

/**
 * Normalizes and extracts array of phone numbers from user payload.
 * Supports:
 * - user.phone: "+919650168435"
 * - user.phone: ["+919650168435", "+919876543210"]
 * - user.phones: ["+919650168435", "+919876543210"]
 * - user.phone: "+919650168435, +919876543210"
 * - user.mobile / user.mobiles
 *
 * @param {object} user
 * @returns {string[]} unique trimmed phone numbers
 */
function extractPhoneNumbers(user) {
  if (!user || typeof user !== "object") return [];

  const candidates = [
    user.phones,
    user.phone,
    user.phone_numbers,
    user.phone_number,
    user.mobiles,
    user.mobile,
  ];

  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate) continue;

    const list = Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string"
        ? candidate.split(/[;,]/)
        : [candidate];

    for (const item of list) {
      if (item === null || item === undefined) continue;
      const str = String(item).trim();
      if (!str) continue;
      if (!seen.has(str)) {
        seen.add(str);
        result.push(str);
      }
    }
  }

  return result;
}

/**
 * Normalizes and extracts array of email addresses from user payload.
 * Supports:
 * - user.email: "user@example.com"
 * - user.email: ["a@example.com", "b@example.com"]
 * - user.emails: ["a@example.com", "b@example.com"]
 * - user.email: "a@example.com, b@example.com"
 *
 * @param {object} user
 * @returns {string[]} unique valid trimmed emails
 */
function extractEmails(user) {
  if (!user || typeof user !== "object") return [];

  const candidates = [user.emails, user.email];

  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate) continue;

    const list = Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string"
        ? candidate.split(/[;,]/)
        : [candidate];

    for (const item of list) {
      if (item === null || item === undefined) continue;
      const str = String(item).trim().toLowerCase();
      if (!str || !str.includes("@")) continue;
      if (!seen.has(str)) {
        seen.add(str);
        result.push(str);
      }
    }
  }

  return result;
}

/**
 * Normalizes Firebase registration token URL or string.
 */
function normalizeFirebaseToken(rawValue) {
  if (typeof rawValue !== "string") return null;

  const token = rawValue.trim();
  if (!token) return null;

  // If token is a Web Push endpoint URL, extract the registration token
  if (/^https?:\/\//i.test(token)) {
    try {
      const url = new URL(token);
      const isFcmHost =
        url.hostname === "fcm.googleapis.com" ||
        url.hostname.endsWith(".fcm.googleapis.com");
      const fcmSendPrefix = "/fcm/send/";

      if (isFcmHost && url.pathname.startsWith(fcmSendPrefix)) {
        const extracted = decodeURIComponent(
          url.pathname.slice(fcmSendPrefix.length),
        ).trim();
        return extracted || null;
      }
    } catch {
      // Keep original token if URL parsing fails
    }
  }

  return token;
}

/**
 * Normalizes and extracts array of push / FCM tokens from user payload.
 * Supports:
 * - user.fcm_token / user.fcm_tokens (string or array)
 * - user.firebase_token / user.firebase_tokens (string or array)
 * - user.push_token / user.push_tokens (string or array)
 * - user.fcmToken / user.fcmTokens (camelCase)
 *
 * @param {object} user
 * @returns {string[]} unique normalized tokens
 */
function extractPushTokens(user) {
  if (!user || typeof user !== "object") return [];

  const candidates = [
    user.fcm_tokens,
    user.fcm_token,
    user.fcmTokens,
    user.fcmToken,
    user.firebase_tokens,
    user.firebase_token,
    user.firebaseTokens,
    user.firebaseToken,
    user.push_tokens,
    user.push_token,
    user.pushTokens,
    user.pushToken,
    user.tokens,
    user.device_tokens,
  ];

  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate) continue;

    const list = Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string"
        ? candidate.split(/[;,]/)
        : [candidate];

    for (const item of list) {
      if (!item) continue;
      const normalized = normalizeFirebaseToken(item);
      if (!normalized) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }

  return result;
}

module.exports = {
  extractPhoneNumbers,
  extractEmails,
  extractPushTokens,
  normalizeFirebaseToken,
};
