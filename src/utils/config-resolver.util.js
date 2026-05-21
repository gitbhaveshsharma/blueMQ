const { getDb } = require("../db");

/**
 * Resolve schedule configuration using the 3-tier hierarchy:
 *
 *   Priority 1 — per-schedule request overrides
 *   Priority 2 — client_settings (per-client DB row)
 *   Priority 3 — app_settings (global defaults)
 *
 * Used at schedule creation time and in the polling worker.
 *
 * @param {string} clientId          — the client's app_id
 * @param {object} [requestOverrides] — optional per-schedule overrides from API body
 * @param {number} [requestOverrides.max_retries]
 * @param {string} [requestOverrides.timezone]
 * @returns {Promise<{ max_retries: number, timezone: string }>}
 */
async function resolveScheduleConfig(clientId, requestOverrides = {}) {
  const sql = getDb();

  // ─── Layer 3: Global defaults from app_settings ───
  const globalRows = await sql`
    SELECT key, value FROM app_settings
    WHERE key IN ('schedule_max_retries', 'schedule_default_timezone')
  `;

  const globals = {};
  for (const row of globalRows) {
    globals[row.key] = row.value;
  }

  // ─── Layer 2: Client-specific overrides ───
  const clientRows = await sql`
    SELECT max_retries, default_timezone
    FROM client_settings
    WHERE client_id = ${clientId}
    LIMIT 1
  `;
  const clientSettings = clientRows[0] || {};

  // ─── Merge: app_settings → client_settings → requestOverrides ───
  const maxRetries =
    requestOverrides.max_retries ??
    clientSettings.max_retries ??
    parseInt(globals.schedule_max_retries || "3", 10);

  const timezone =
    requestOverrides.timezone ??
    clientSettings.default_timezone ??
    globals.schedule_default_timezone ??
    "UTC";

  return {
    max_retries: maxRetries,
    timezone,
  };
}

/**
 * Get the global poll interval cron expression from app_settings.
 * This is a global-only setting — not per-client.
 *
 * @returns {Promise<string>} cron expression (e.g. every 2 minutes)
 */
async function getPollIntervalCron() {
  const sql = getDb();
  const rows = await sql`
    SELECT value FROM app_settings
    WHERE key = 'schedule_poll_interval_cron'
    LIMIT 1
  `;

  return rows[0]?.value || "*/2 * * * *";
}

module.exports = { resolveScheduleConfig, getPollIntervalCron };
