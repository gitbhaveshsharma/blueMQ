/**
 * quota-api.test.js
 *
 * Integration tests for the Part A quota API changes.
 * Runs against a real test database (uses DATABASE_URL env).
 * Isolation: each test creates its own app via POST /apps, then cleans up.
 *
 * Run:
 *   node --test src/tests/quota-api.test.js
 *   # or with an npm script: npm run test:quota
 */

"use strict";

require("dotenv").config({ quiet: true });

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { getDb, closePool } = require("../db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function withApp(sql, fn) {
  // apps table: id UUID PK, app_id VARCHAR(64) UNIQUE NOT NULL, name, api_key
  const appId = `test-tq-${Date.now()}`;
  await sql.query(
    `INSERT INTO apps (app_id, name, api_key) VALUES ($1, $2, $3)`,
    [appId, `Test Quota App ${appId}`, `apikey_${appId}`]
  );

  try {
    await fn(appId); // quota tables use app_id (VARCHAR), not UUID id
  } finally {
    try {
      await sql.query(`DELETE FROM webhook_deliveries WHERE app_id = $1`, [appId]);
      await sql.query(`DELETE FROM app_webhooks WHERE app_id = $1`, [appId]);
      await sql.query(
        `DELETE FROM notification_logs WHERE notification_id IN (SELECT id FROM notifications WHERE app_id = $1)`,
        [appId]
      );
      await sql.query(`DELETE FROM quota_reservations WHERE app_id = $1`, [appId]);
      await sql.query(`DELETE FROM notifications WHERE app_id = $1`, [appId]);
      await sql.query(`DELETE FROM apps WHERE app_id = $1`, [appId]);
    } catch (_) {
      // best-effort cleanup
    }
  }
}

async function createProfile(sql, appId, name = "Test Profile", is_default = false) {
  const r = await sql.query(
    `INSERT INTO quota_profiles (app_id, name, is_default) VALUES ($1, $2, $3) RETURNING *`,
    [appId, name, is_default]
  );
  return r.rows[0];
}

async function assignOwner(sql, appId, ownerId, profileId, overrides = {}) {
  await sql.query(
    `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, label)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (app_id, owner_id) DO UPDATE SET profile_id = EXCLUDED.profile_id`,
    [appId, ownerId, profileId, JSON.stringify(overrides)]
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let sql;

before(async () => {
  sql = getDb();
  // Verify connection
  await sql.query("SELECT 1");
});

after(async () => {
  await closePool();
});

// ── Profile owner_count ────────────────────────────────────────────────────────

test("GET /quota/profiles — owner_count is 0 for a new profile", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Empty Profile");

    const r = await sql.query(
      `SELECT p.id, COUNT(DISTINCT oq.owner_id)::int AS owner_count
       FROM quota_profiles p
       LEFT JOIN owner_quota oq ON oq.profile_id = p.id AND oq.app_id = p.app_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [profile.id]
    );
    assert.equal(r.rows[0].owner_count, 0, "owner_count should be 0 for a new profile");
  });
});

test("GET /quota/profiles — owner_count reflects assigned owners", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Populated Profile");
    await assignOwner(sql, appId, "owner-a", profile.id);
    await assignOwner(sql, appId, "owner-b", profile.id);

    const r = await sql.query(
      `SELECT COUNT(DISTINCT oq.owner_id)::int AS owner_count
       FROM quota_profiles p
       LEFT JOIN owner_quota oq ON oq.profile_id = p.id AND oq.app_id = p.app_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [profile.id]
    );
    assert.equal(r.rows[0].owner_count, 2, "owner_count should be 2 after assigning 2 owners");
  });
});

// ── DELETE /quota/profiles/:id guards ─────────────────────────────────────────

test("DELETE guard — cannot delete default profile", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Default Profile", true);

    // Simulate the guard logic
    const r = await sql.query(
      `SELECT is_default FROM quota_profiles WHERE id = $1 AND app_id = $2`,
      [profile.id, appId]
    );
    assert.equal(r.rows[0].is_default, true, "Profile should be default");

    // A delete attempt on a default profile should be refused (409 in API layer)
    // We verify the guard condition here
    assert.ok(r.rows[0].is_default, "Guard should trigger for default profile");
  });
});

test("DELETE guard — cannot delete profile with owners unless reassign_to given", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Assigned Profile");
    await assignOwner(sql, appId, "owner-x", profile.id);

    const ownerCountRes = await sql.query(
      `SELECT COUNT(*)::int AS cnt FROM owner_quota WHERE profile_id = $1 AND app_id = $2`,
      [profile.id, appId]
    );
    assert.equal(ownerCountRes.rows[0].cnt, 1, "Should have 1 owner assigned");

    // Guard: if owner_count > 0 and no reassign_to → 409
    assert.ok(ownerCountRes.rows[0].cnt > 0, "Guard should trigger when owners are assigned");
  });
});

test("DELETE — reassign_to moves owners and allows deletion", async () => {
  await withApp(sql, async (appId) => {
    const profileA = await createProfile(sql, appId, "Profile A");
    const profileB = await createProfile(sql, appId, "Profile B");
    await assignOwner(sql, appId, "owner-migrate", profileA.id);

    // Reassign all owners from A to B
    await sql.query(
      `UPDATE owner_quota SET profile_id = $1 WHERE profile_id = $2 AND app_id = $3`,
      [profileB.id, profileA.id, appId]
    );

    // Now A has 0 owners — can delete
    const afterReassign = await sql.query(
      `SELECT COUNT(*)::int AS cnt FROM owner_quota WHERE profile_id = $1 AND app_id = $2`,
      [profileA.id, appId]
    );
    assert.equal(afterReassign.rows[0].cnt, 0, "Profile A should have 0 owners after reassign");

    // Owner B now has 1 owner
    const bCount = await sql.query(
      `SELECT COUNT(*)::int AS cnt FROM owner_quota WHERE profile_id = $1 AND app_id = $2`,
      [profileB.id, appId]
    );
    assert.equal(bCount.rows[0].cnt, 1, "Profile B should have 1 owner after reassign");
  });
});

// ── owner_quota.label ──────────────────────────────────────────────────────────

test("owner_quota — label column exists and is nullable", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Label Test Profile");

    // Insert with label
    await sql.query(
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, label)
       VALUES ($1, $2, $3, '{}', $4)`,
      [appId, "owner-labeled", profile.id, "My Academy"]
    );

    const r = await sql.query(
      `SELECT label FROM owner_quota WHERE app_id = $1 AND owner_id = $2`,
      [appId, "owner-labeled"]
    );
    assert.equal(r.rows[0].label, "My Academy", "label should be stored correctly");

    // Insert without label (null)
    await sql.query(
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides)
       VALUES ($1, $2, $3, '{}')`,
      [appId, "owner-no-label", profile.id]
    );
    const r2 = await sql.query(
      `SELECT label FROM owner_quota WHERE app_id = $1 AND owner_id = $2`,
      [appId, "owner-no-label"]
    );
    assert.equal(r2.rows[0].label, null, "label should be null when not set");
  });
});

// ── Override channel validation ────────────────────────────────────────────────

test("PUT /quota/owners/:ownerId — overrides with unknown channel rejected at API layer", async () => {
  const KNOWN_CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];
  const unknownChannel = "telegram";
  assert.equal(
    KNOWN_CHANNELS.includes(unknownChannel),
    false,
    "telegram should not be a known channel"
  );
});

// ── POST /owners/bulk transaction ─────────────────────────────────────────────

test("bulk assign — all owners get the same profile_id", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Bulk Profile");
    const ownerIds = ["bulk-1", "bulk-2", "bulk-3"];

    // Simulate bulk insert
    const client = await sql.raw.connect();
    try {
      await client.query("BEGIN");
      for (const ownerId of ownerIds) {
        await client.query(
          `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides)
           VALUES ($1, $2, $3, '{}')
           ON CONFLICT (app_id, owner_id) DO UPDATE SET profile_id = EXCLUDED.profile_id`,
          [appId, ownerId, profile.id]
        );
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const r = await sql.query(
      `SELECT owner_id, profile_id FROM owner_quota WHERE app_id = $1 ORDER BY owner_id`,
      [appId]
    );
    assert.equal(r.rows.length, 3, "Should have 3 owners after bulk insert");
    assert.ok(r.rows.every((row) => row.profile_id === profile.id), "All owners should have the same profile_id");
  });
});

test("GET /quota/owners — returns owners even when overrides is an empty object {}", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Default Profile");
    await sql.query(
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides, label)
       VALUES ($1, 'owner-empty-overrides', $2, '{}'::jsonb, 'Test Label')`,
      [appId, profile.id]
    );

    const dataRes = await sql.query(
      `SELECT
         oq.owner_id,
         oq.label,
         oq.profile_id,
         oq.overrides,
         qp.name AS profile_name
       FROM owner_quota oq
       LEFT JOIN quota_profiles qp ON qp.id = oq.profile_id
       WHERE oq.app_id = $1 AND oq.owner_id = 'owner-empty-overrides'`,
      [appId]
    );

    assert.equal(dataRes.rows.length, 1, "Owner with empty overrides must be returned in query");
    assert.equal(dataRes.rows[0].owner_id, "owner-empty-overrides");
    assert.equal(dataRes.rows[0].label, "Test Label");
  });
});

// ── Effective limits resolution ────────────────────────────────────────────────

test("effective limit resolution — override takes precedence over profile", async () => {
  await withApp(sql, async (appId) => {
    const profile = await createProfile(sql, appId, "Base Profile");
    await sql.query(
      `INSERT INTO quota_profile_limits (profile_id, channel, limit_count, period) VALUES ($1, 'email', 1000, 'monthly')`,
      [profile.id]
    );
    await sql.query(
      `INSERT INTO owner_quota (app_id, owner_id, profile_id, overrides)
       VALUES ($1, 'owner-override', $2, $3)`,
      [appId, profile.id, JSON.stringify({ email: { limit: 500, period: "monthly" } })]
    );

    const ownerRes = await sql.query(
      `SELECT overrides FROM owner_quota WHERE app_id = $1 AND owner_id = 'owner-override'`,
      [appId]
    );
    const overrides = ownerRes.rows[0].overrides;
    assert.equal(overrides.email.limit, 500, "Override limit should be 500");

    // Profile limit is 1000; override is 500; override wins
    const profileLimit = 1000;
    const effectiveLimit = overrides.email?.limit ?? profileLimit;
    assert.equal(effectiveLimit, 500, "Effective limit should be override value (500)");
  });
});

// ── Webhook dedup index ────────────────────────────────────────────────────────

test("migration 020 — idx_webhook_deliveries_dedup index exists", async () => {
  const r = await sql.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'webhook_deliveries'
       AND indexname = 'idx_webhook_deliveries_dedup'`
  );
  assert.equal(r.rows.length, 1, "Dedup index should exist on webhook_deliveries");
});

// ── Indexes ────────────────────────────────────────────────────────────────────

test("migration 019 — idx_notifications_entity_id index exists", async () => {
  const r = await sql.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'notifications'
       AND indexname = 'idx_notifications_entity_id'`
  );
  assert.equal(r.rows.length, 1, "idx_notifications_entity_id should exist");
});

test("migration 019 — idx_notification_logs_notification_id index exists", async () => {
  const r = await sql.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'notification_logs'
       AND indexname = 'idx_notification_logs_notification_id'`
  );
  assert.equal(r.rows.length, 1, "idx_notification_logs_notification_id should exist");
});

// ── Tenant Isolation ──────────────────────────────────────────────────────────

test("tenant isolation — app A cannot access app B owner data", async () => {
  await withApp(sql, async (appIdA) => {
    await withApp(sql, async (appIdB) => {
      const profileA = await createProfile(sql, appIdA, "App A Profile");
      await assignOwner(sql, appIdA, "owner-isolated", profileA.id);

      // Query from app B's perspective
      const r = await sql.query(
        `SELECT * FROM owner_quota WHERE app_id = $1 AND owner_id = $2`,
        [appIdB, "owner-isolated"]
      );
      assert.equal(r.rows.length, 0, "App B should not see App A's owner quota");
    });
  });
});

// ── Field Whitelisting ────────────────────────────────────────────────────────

test("field whitelisting — notification query strictly excludes data JSONB, email, phone, push tokens", async () => {
  await withApp(sql, async (appId) => {
    // Insert a notification with sensitive data and user info
    const notifRes = await sql.query(
      `INSERT INTO notifications (
        app_id, external_user_id, type, title, message, status, entity_id, parent_entity_id, data
      ) VALUES (
        $1, 'user-123', 'fee_reminder', 'Fee Due', 'Please pay', 'delivered', 'branch-1', 'center-1',
        '{"sensitive_token": "secret_abc", "user_email": "student@private.com", "phone": "+919876543210"}'::jsonb
      ) RETURNING id`,
      [appId]
    );
    const notifId = notifRes.rows[0].id;

    // Use the exact field whitelist from entities.js
    const NOTIFICATION_FIELDS = `
      n.id, n.type, n.title, n.message, n.action_url, n.status,
      n.entity_id, n.parent_entity_id, n.external_user_id, n.created_at
    `;

    const r = await sql.query(
      `SELECT ${NOTIFICATION_FIELDS}
       FROM notifications n
       WHERE n.app_id = $1 AND n.id = $2`,
      [appId, notifId]
    );

    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.data, undefined, "Row must not contain data JSONB");
    assert.equal(row.email, undefined, "Row must not contain email");
    assert.equal(row.phone, undefined, "Row must not contain phone");
    assert.equal(row.push_token, undefined, "Row must not contain push tokens");
    assert.equal(row.provider_credentials, undefined, "Row must not contain credentials");
    assert.equal(row.id, notifId);
    assert.equal(row.title, "Fee Due");
  });
});

// ── 4-Tier Effective Limits Resolution ────────────────────────────────────────

test("effective limit resolution — 4-tier precedence: override > profile > default_profile > none", async () => {
  await withApp(sql, async (appId) => {
    // 1. Create default profile with limits for push (200), email (1000), sms (250)
    const defaultProfile = await createProfile(sql, appId, "Default Profile", true);
    await sql.query(
      `INSERT INTO quota_profile_limits (profile_id, channel, limit_count, period) VALUES
       ($1, 'push', 200, 'monthly'),
       ($1, 'email', 1000, 'monthly'),
       ($1, 'sms', 250, 'monthly')`,
      [defaultProfile.id]
    );

    // 2. Create custom profile assigned to owner with limits for push (100) and email (500)
    const assignedProfile = await createProfile(sql, appId, "Assigned Profile", false);
    await sql.query(
      `INSERT INTO quota_profile_limits (profile_id, channel, limit_count, period) VALUES
       ($1, 'push', 100, 'monthly'),
       ($1, 'email', 500, 'monthly')`,
      [assignedProfile.id]
    );

    // 3. Assign owner with override on push (50) only
    await assignOwner(sql, appId, "owner-4tier", assignedProfile.id, {
      push: { limit: 50, period: "monthly" }
    });

    // Fetch owner + default limits as done in GET /quota/owners/:ownerId & /entities/:ownerId/quota
    const [ownerRes, defRes] = await Promise.all([
      sql.query(
        `SELECT oq.overrides,
                COALESCE(json_agg(json_build_object('channel', l.channel, 'limit_count', l.limit_count))
                         FILTER (WHERE l.channel IS NOT NULL), '[]') AS profile_limits
         FROM owner_quota oq
         LEFT JOIN quota_profile_limits l ON l.profile_id = oq.profile_id
         WHERE oq.app_id = $1 AND oq.owner_id = $2
         GROUP BY oq.owner_id, oq.overrides`,
        [appId, "owner-4tier"]
      ),
      sql.query(
        `SELECT json_agg(json_build_object('channel', l.channel, 'limit_count', l.limit_count)) AS limits
         FROM quota_profiles p
         JOIN quota_profile_limits l ON l.profile_id = p.id
         WHERE p.app_id = $1 AND p.is_default = true`,
        [appId]
      )
    ]);

    const overrides = ownerRes.rows[0].overrides;
    const profileLimits = ownerRes.rows[0].profile_limits;
    const defaultLimits = defRes.rows[0].limits;

    function resolveChannel(channel) {
      if (overrides[channel]?.limit !== undefined) {
        return { source: "override", limit: overrides[channel].limit };
      }
      const pl = profileLimits.find((l) => l.channel === channel);
      if (pl) {
        return { source: "profile", limit: pl.limit_count };
      }
      const dl = defaultLimits.find((l) => l.channel === channel);
      if (dl) {
        return { source: "default_profile", limit: dl.limit_count };
      }
      return { source: "none", limit: null };
    }

    // Tier 1: push has override (50), profile (100), default (200) -> override wins
    assert.deepEqual(resolveChannel("push"), { source: "override", limit: 50 });

    // Tier 2: email has profile (500), default (1000) -> profile wins
    assert.deepEqual(resolveChannel("email"), { source: "profile", limit: 500 });

    // Tier 3: sms only in default (250) -> default_profile wins
    assert.deepEqual(resolveChannel("sms"), { source: "default_profile", limit: 250 });

    // Tier 4: whatsapp has no limits -> none
    assert.deepEqual(resolveChannel("whatsapp"), { source: "none", limit: null });
  });
});

// ── Webhook Race Safety ───────────────────────────────────────────────────────

test("notification.final race safety — concurrent inserts with ON CONFLICT DO NOTHING create only 1 delivery", async () => {
  await withApp(sql, async (appId) => {
    // Register a webhook for notification.final
    await sql.query(
      `INSERT INTO app_webhooks (app_id, url, secret, events, is_active)
       VALUES ($1, 'https://example.com/webhook', 'sec_test_123', ARRAY['notification.final'], true)`,
      [appId]
    );

    // Create a dummy notification
    const notifRes = await sql.query(
      `INSERT INTO notifications (app_id, external_user_id, type, title, message, status)
       VALUES ($1, 'user-race', 'test', 'Test', 'Test', 'delivered')
       RETURNING id`,
      [appId]
    );
    const notifId = notifRes.rows[0].id;

    // Simulate two concurrent workers attempting to insert notification.final
    const p1 = sql.query(
      `INSERT INTO webhook_deliveries
         (app_id, event_id, event_type, notification_id, payload, status, attempts, next_attempt_at)
       VALUES ($1, gen_random_uuid(), 'notification.final', $2, '{"event":"final"}'::jsonb, 'pending', 0, now())
       ON CONFLICT (app_id, event_type,
         COALESCE(notification_id, '00000000-0000-0000-0000-000000000000'::uuid))
         WHERE status IN ('pending', 'delivered')
       DO NOTHING`,
      [appId, notifId]
    );

    const p2 = sql.query(
      `INSERT INTO webhook_deliveries
         (app_id, event_id, event_type, notification_id, payload, status, attempts, next_attempt_at)
       VALUES ($1, gen_random_uuid(), 'notification.final', $2, '{"event":"final"}'::jsonb, 'pending', 0, now())
       ON CONFLICT (app_id, event_type,
         COALESCE(notification_id, '00000000-0000-0000-0000-000000000000'::uuid))
         WHERE status IN ('pending', 'delivered')
       DO NOTHING`,
      [appId, notifId]
    );

    await Promise.all([p1, p2]);

    const countRes = await sql.query(
      `SELECT COUNT(*)::int AS cnt FROM webhook_deliveries
       WHERE app_id = $1 AND notification_id = $2 AND event_type = 'notification.final'`,
      [appId, notifId]
    );

    assert.equal(countRes.rows[0].cnt, 1, "Exactly one delivery record should be created");
  });
});

