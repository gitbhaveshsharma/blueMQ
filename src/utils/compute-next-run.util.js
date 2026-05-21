const { CronExpressionParser } = require("cron-parser");

/**
 * Compute the next run time for a scheduled notification.
 *
 * Always computes in the schedule's stored timezone, returns UTC.
 * Supports: daily, weekly, monthly, custom_cron.
 *
 * @param {object} schedule
 * @param {string} schedule.frequency   — 'daily' | 'weekly' | 'monthly' | 'custom_cron'
 * @param {string} [schedule.cron_expression] — required if frequency is 'custom_cron'
 * @param {number} [schedule.day_of_month]    — 1-28, required for 'monthly'
 * @param {number} [schedule.day_of_week]     — 0-6 (0=Sunday), required for 'weekly'
 * @param {string} [schedule.time_of_day]     — 'HH:MM' or 'HH:MM:SS', required for daily/weekly/monthly
 * @param {string} schedule.timezone          — IANA timezone (e.g. 'Asia/Kolkata')
 * @param {Date}   [after]                    — compute next run after this time (default: now)
 * @returns {Date} next run time in UTC
 */
function computeNextRun(schedule, after) {
  const {
    frequency,
    cron_expression,
    day_of_month,
    day_of_week,
    time_of_day,
    timezone,
  } = schedule;

  const now = after || new Date();

  switch (frequency) {
    case "daily":
      return computeDaily(time_of_day, timezone, now);

    case "weekly":
      return computeWeekly(day_of_week, time_of_day, timezone, now);

    case "monthly":
      return computeMonthly(day_of_month, time_of_day, timezone, now);

    case "custom_cron":
      return computeCron(cron_expression, timezone, now);

    default:
      throw new Error(`[compute-next-run] Unsupported frequency: ${frequency}`);
  }
}

/**
 * Parse time_of_day string into hours and minutes.
 * Accepts "HH:MM" or "HH:MM:SS".
 */
function parseTime(time_of_day) {
  const parts = String(time_of_day).split(":");
  return {
    hours: parseInt(parts[0], 10),
    minutes: parseInt(parts[1], 10),
  };
}

/**
 * Create a Date in a specific timezone, then convert to UTC.
 * Uses Intl.DateTimeFormat to resolve timezone offsets correctly.
 */
function createDateInTimezone(year, month, day, hours, minutes, timezone) {
  // Build an ISO-ish string and resolve via Date constructor
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;

  // Get the UTC offset for this datetime in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Create the date assuming UTC first
  const utcDate = new Date(dateStr + "Z");

  // Format the UTC date in the target timezone to find the offset
  const parts = formatter.formatToParts(utcDate);
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

  const tzYear = get("year");
  const tzMonth = get("month");
  const tzDay = get("day");
  const tzHour = get("hour") === 24 ? 0 : get("hour");
  const tzMinute = get("minute");

  // Calculate offset: what UTC shows as vs what timezone shows as
  const utcMs = Date.UTC(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
    utcDate.getUTCHours(),
    utcDate.getUTCMinutes(),
  );
  const tzMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute);
  const offsetMs = utcMs - tzMs;

  // Now create the actual target datetime in the timezone and convert to UTC
  const targetLocal = Date.UTC(year, month - 1, day, hours, minutes, 0);
  return new Date(targetLocal + offsetMs);
}

/**
 * Get current date components in a specific timezone.
 */
function getNowInTimezone(timezone, now) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function computeDaily(time_of_day, timezone, now) {
  const { hours, minutes } = parseTime(time_of_day);
  const tz = getNowInTimezone(timezone, now);

  // Try today first
  let candidate = createDateInTimezone(
    tz.year,
    tz.month,
    tz.day,
    hours,
    minutes,
    timezone,
  );

  // If already past, move to tomorrow
  if (candidate <= now) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tzTomorrow = getNowInTimezone(timezone, tomorrow);
    candidate = createDateInTimezone(
      tzTomorrow.year,
      tzTomorrow.month,
      tzTomorrow.day,
      hours,
      minutes,
      timezone,
    );
  }

  return candidate;
}

function computeWeekly(dayOfWeek, time_of_day, timezone, now) {
  const { hours, minutes } = parseTime(time_of_day);
  const tz = getNowInTimezone(timezone, now);

  // Get current day of week in timezone (0=Sunday)
  const tzDate = new Date(
    Date.UTC(tz.year, tz.month - 1, tz.day, 12, 0, 0),
  );
  const currentDow = tzDate.getUTCDay();

  let daysUntil = dayOfWeek - currentDow;
  if (daysUntil < 0) daysUntil += 7;

  // Try this week
  const targetDate = new Date(tzDate.getTime() + daysUntil * 24 * 60 * 60 * 1000);
  const targetTz = getNowInTimezone(timezone, targetDate);

  let candidate = createDateInTimezone(
    targetTz.year,
    targetTz.month,
    targetTz.day,
    hours,
    minutes,
    timezone,
  );

  // If already past (same day but time passed), push to next week
  if (candidate <= now) {
    const nextWeek = new Date(targetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextTz = getNowInTimezone(timezone, nextWeek);
    candidate = createDateInTimezone(
      nextTz.year,
      nextTz.month,
      nextTz.day,
      hours,
      minutes,
      timezone,
    );
  }

  return candidate;
}

function computeMonthly(dayOfMonth, time_of_day, timezone, now) {
  const { hours, minutes } = parseTime(time_of_day);
  const tz = getNowInTimezone(timezone, now);

  // Cap at 28 to avoid month-end issues
  const day = Math.min(dayOfMonth, 28);

  // Try this month
  let candidate = createDateInTimezone(
    tz.year,
    tz.month,
    day,
    hours,
    minutes,
    timezone,
  );

  // If already past, try next month
  if (candidate <= now) {
    let nextMonth = tz.month + 1;
    let nextYear = tz.year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear++;
    }
    candidate = createDateInTimezone(
      nextYear,
      nextMonth,
      day,
      hours,
      minutes,
      timezone,
    );
  }

  return candidate;
}

function computeCron(cronExpression, timezone, now) {
  const interval = CronExpressionParser.parseExpression(cronExpression, {
    currentDate: now,
    tz: timezone,
  });

  const next = interval.next();
  return next.toDate();
}

/**
 * Compute the initial next_run_at for a new schedule.
 *
 * For one_time: returns the run_at time directly (already in UTC from client).
 * For recurring: computes the first occurrence based on frequency settings.
 *
 * @param {object} schedule — the schedule config
 * @returns {Date} next_run_at in UTC
 */
function computeInitialNextRun(schedule) {
  if (schedule.type === "one_time") {
    return new Date(schedule.run_at);
  }

  return computeNextRun(schedule);
}

module.exports = { computeNextRun, computeInitialNextRun };
