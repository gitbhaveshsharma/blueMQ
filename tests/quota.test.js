"use strict";

/**
 * Unit tests for src/utils/quota.js
 *
 * These tests mock the DB client so no real database is needed.
 * Run with: npx jest tests/quota.test.js
 */

const { getPeriodStart, guardEntityParent } = require("../src/utils/quota");

// ─── getPeriodStart ───────────────────────────────────────────────────────────

describe("getPeriodStart", () => {
  it("returns the first day of the current month for monthly period", () => {
    const result = getPeriodStart("monthly", "Asia/Kolkata");
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("returns today's date (YYYY-MM-DD) for daily period", () => {
    const result = getPeriodStart("daily", "Asia/Kolkata");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should not be the 01 only (unless today is the 1st)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(result).toBe(today);
  });

  it("handles UTC timezone", () => {
    const result = getPeriodStart("monthly", "UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("monthly period_start is always -01", () => {
    const result = getPeriodStart("monthly", "America/New_York");
    expect(result.endsWith("-01")).toBe(true);
  });
});

// ─── guardEntityParent ────────────────────────────────────────────────────────

describe("guardEntityParent", () => {
  function makeSql(firstInsertReturnsRow, existingParent) {
    let callCount = 0;
    return {
      query: jest.fn(async (sql) => {
        callCount++;
        if (callCount === 1) {
          // First call: the INSERT ... ON CONFLICT DO NOTHING
          return { rows: firstInsertReturnsRow ? [{ parent_entity_id: "parent_a" }] : [] };
        }
        // Second call: the SELECT (only reached if first returned no rows)
        return { rows: existingParent ? [{ parent_entity_id: existingParent }] : [] };
      }),
    };
  }

  it("returns conflict: false on first sight (INSERT succeeds)", async () => {
    const sql = makeSql(true, null);
    const result = await guardEntityParent(sql, "app1", "entity1", "parent_a");
    expect(result.conflict).toBe(false);
  });

  it("returns conflict: false when stored parent matches", async () => {
    const sql = makeSql(false, "parent_a");
    const result = await guardEntityParent(sql, "app1", "entity1", "parent_a");
    expect(result.conflict).toBe(false);
  });

  it("returns conflict: true when stored parent differs", async () => {
    const sql = makeSql(false, "parent_b");
    const result = await guardEntityParent(sql, "app1", "entity1", "parent_a");
    expect(result.conflict).toBe(true);
    expect(result.storedParent).toBe("parent_b");
  });
});

// ─── appHasQuotas ─────────────────────────────────────────────────────────────

describe("appHasQuotas", () => {
  beforeEach(() => {
    // Clear module cache for the quota module to reset in-memory cache between tests
    jest.resetModules();
  });

  it("returns true when quota_profiles exist", async () => {
    const { appHasQuotas, invalidateQuotaCache } = require("../src/utils/quota");
    const sql = {
      query: jest.fn(async (q) => {
        if (q.includes("quota_profiles")) return { rows: [{ 1: 1 }] };
        return { rows: [] };
      }),
    };
    invalidateQuotaCache("app1");
    const result = await appHasQuotas(sql, "app1");
    expect(result).toBe(true);
  });

  it("returns false when no profiles or owner_quota exist", async () => {
    const { appHasQuotas, invalidateQuotaCache } = require("../src/utils/quota");
    const sql = { query: jest.fn(async () => ({ rows: [] })) };
    invalidateQuotaCache("app_no_quota");
    const result = await appHasQuotas(sql, "app_no_quota");
    expect(result).toBe(false);
  });

  it("caches the result for subsequent calls", async () => {
    const { appHasQuotas, invalidateQuotaCache } = require("../src/utils/quota");
    const sql = { query: jest.fn(async () => ({ rows: [] })) };
    invalidateQuotaCache("app_cached");

    await appHasQuotas(sql, "app_cached");
    await appHasQuotas(sql, "app_cached");

    // Should only call DB twice (quota_profiles + owner_quota) on first call
    expect(sql.query.mock.calls.length).toBe(2);
  });
});

// ─── resolveLimit ─────────────────────────────────────────────────────────────

describe("resolveLimit", () => {
  let resolveLimit;
  beforeEach(() => {
    jest.resetModules();
    ({ resolveLimit } = require("../src/utils/quota"));
  });

  it("returns owner-specific override when present", async () => {
    const sql = {
      query: jest.fn(async (q) => {
        if (q.includes("owner_quota")) {
          return {
            rows: [{ overrides: { push: { limit: 500, period: "monthly" } }, limit_count: null, period: null }],
          };
        }
        return { rows: [] };
      }),
    };
    const result = await resolveLimit(sql, "app1", "owner1", "push");
    expect(result).toEqual({ limit: 500, period: "monthly" });
  });

  it("falls back to profile limit when override is absent", async () => {
    const sql = {
      query: jest.fn(async (q) => {
        if (q.includes("owner_quota")) {
          return { rows: [{ overrides: {}, limit_count: 1000, period: "monthly" }] };
        }
        return { rows: [] };
      }),
    };
    const result = await resolveLimit(sql, "app1", "owner1", "email");
    expect(result).toEqual({ limit: 1000, period: "monthly" });
  });

  it("falls back to app default profile when owner has no quota row", async () => {
    const sql = {
      query: jest.fn(async (q) => {
        if (q.includes("owner_quota")) return { rows: [] };
        if (q.includes("quota_profiles")) {
          return { rows: [{ limit_count: 200, period: "daily" }] };
        }
        return { rows: [] };
      }),
    };
    const result = await resolveLimit(sql, "app1", "owner_new", "sms");
    expect(result).toEqual({ limit: 200, period: "daily" });
  });

  it("returns null when no limit is configured", async () => {
    const sql = { query: jest.fn(async () => ({ rows: [] })) };
    const result = await resolveLimit(sql, "app1", "owner_no_limit", "push");
    expect(result).toBeNull();
  });
});
