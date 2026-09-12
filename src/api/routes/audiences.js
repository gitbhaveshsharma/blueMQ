const { Router } = require("express");
const multer = require("multer");
const { getDb } = require("../../db");
const {
  AUDIENCE_MEMBER_FIELDS,
  normalizeAudienceMember,
  hasDeliveryAddress,
  parseAudienceImport,
  membersToCsv,
} = require("../../utils/audience-member");
const { notifyHandler } = require("./notify");

const router = Router();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_IMPORT_ROWS = 50_000;
const MAX_IMPORT_BYTES = Math.max(
  1024,
  Math.min(
    25 * 1024 * 1024,
    Number.parseInt(process.env.AUDIENCE_IMPORT_MAX_BYTES, 10) ||
      10 * 1024 * 1024,
  ),
);
const BROADCAST_PAGE_SIZE = 500;
const BROADCAST_CONCURRENCY = Math.max(
  1,
  Math.min(50, Number.parseInt(process.env.AUDIENCE_BROADCAST_CONCURRENCY, 10) || 10),
);
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_IMPORT_BYTES },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.split(".").pop()?.toLowerCase();
    callback(
      extension === "csv" || extension === "json"
        ? null
        : new Error("Only CSV and JSON files are supported"),
      extension === "csv" || extension === "json",
    );
  },
});

function receiveImportFile(req, res, next) {
  importUpload.single("file")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? `Import file exceeds the ${MAX_IMPORT_BYTES}-byte limit`
        : error.message,
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────

function normalizeName(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parsePage(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, limit, offset: (page - 1) * limit };
}

function validUuid(value) {
  return UUID_RE.test(String(value || ""));
}

async function findAudience(sql, appId, id) {
  if (!validUuid(id)) return null;
  const rows = await sql`
    SELECT id, app_id, name, description, created_at, updated_at
    FROM audiences
    WHERE id = ${id} AND app_id = ${appId}
    LIMIT 1
  `;
  return rows[0] || null;
}

function memberValues(member) {
  return [
    member.user_id,
    member.email,
    member.phone,
    member.fcm_token,
    member.onesignal_player_id,
    member.entity_id,
  ];
}

// ─── GET /audiences ─────────────────────────────────────────

/**
 * List all audiences for the authenticated app.
 * Returns id, name, description, member count, timestamps — NOT full members array.
 */
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const sql = getDb();

    const rows = await sql`
      SELECT
        id,
        name,
        description,
        (SELECT COUNT(*)::int FROM audience_members am
         WHERE am.audience_id = audiences.id) AS member_count,
        created_at,
        updated_at
      FROM audiences
      WHERE app_id = ${appId}
      ORDER BY updated_at DESC
    `;

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[audiences] GET / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /audiences/:id ─────────────────────────────────────

/**
 * Get audience metadata. Members have their own paginated endpoint.
 */
router.get("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const sql = getDb();

    const rows = await sql`
      SELECT
        id, name, description, created_at, updated_at,
        (SELECT COUNT(*)::int FROM audience_members am
         WHERE am.audience_id = audiences.id) AS member_count,
        (SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'user_id', am.user_id,
             'email', am.email,
             'phone', am.phone,
             'fcm_token', am.fcm_token,
             'onesignal_player_id', am.onesignal_player_id,
             'entity_id', am.entity_id
           ) ORDER BY am.created_at, am.id),
           '[]'::jsonb
         )
         FROM audience_members am
         WHERE am.audience_id = audiences.id) AS members
      FROM audiences
      WHERE id = ${id} AND app_id = ${appId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("[audiences] GET /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /audiences ─────────────────────────────────────────

/**
 * Create a new audience.
 *
 * Body: { name, description? }
 */
router.post("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { name, description } = req.body;

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return res.status(400).json({ error: "Required: name" });
    }

    const normalizedDescription = description
      ? String(description).trim() || null
      : null;

    const sql = getDb();

    const rows = await sql`
      INSERT INTO audiences (app_id, name, description)
      VALUES (${appId}, ${normalizedName}, ${normalizedDescription})
      RETURNING id, name, description, created_at, updated_at
    `;

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "An audience with this name already exists",
      });
    }
    console.error("[audiences] POST / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /audiences/:id ──────────────────────────────────────

/**
 * Update audience metadata. Members are managed independently.
 */
router.put("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const { name, description } = req.body;

    const sql = getDb();

    // Fetch existing
    const existingRows = await sql`
      SELECT * FROM audiences WHERE id = ${id} AND app_id = ${appId} LIMIT 1
    `;
    if (existingRows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }
    const existing = existingRows[0];

    const finalName =
      name !== undefined ? normalizeName(name) : existing.name;
    if (!finalName) {
      return res.status(400).json({ error: "name cannot be empty" });
    }

    const finalDescription =
      description !== undefined
        ? String(description || "").trim() || null
        : existing.description;

    const rows = await sql`
      UPDATE audiences
      SET
        name        = ${finalName},
        description = ${finalDescription},
        updated_at  = now()
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING id, name, description, created_at, updated_at
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        error: "An audience with this name already exists",
      });
    }
    console.error("[audiences] PUT /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /audiences/:id ───────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const appId = req.appId;
    const { id } = req.params;
    const sql = getDb();

    const rows = await sql`
      DELETE FROM audiences
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING id
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Audience not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[audiences] DELETE /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Audience members ───────────────────────────────────────

router.get("/:id/members", async (req, res) => {
  try {
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    const { page, limit, offset } = parsePage(req.query);
    const [members, countRows] = await Promise.all([
      sql`
        SELECT id, user_id, email, phone, fcm_token, onesignal_player_id,
               entity_id, created_at, updated_at
        FROM audience_members
        WHERE audience_id = ${audience.id} AND app_id = ${req.appId}
        ORDER BY created_at ASC, id ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS total
        FROM audience_members
        WHERE audience_id = ${audience.id} AND app_id = ${req.appId}
      `,
    ]);
    const total = countRows[0]?.total || 0;
    return res.json({
      success: true,
      data: members,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[audiences] GET members error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/members", async (req, res) => {
  try {
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    const member = normalizeAudienceMember(req.body);
    if (!hasDeliveryAddress(member)) {
      return res.status(400).json({
        error:
          "At least one delivery address is required: email, phone, fcm_token, or onesignal_player_id",
      });
    }
    const rows = await sql`
      INSERT INTO audience_members (
        audience_id, app_id, user_id, email, phone, fcm_token,
        onesignal_player_id, entity_id
      )
      VALUES (
        ${audience.id}, ${req.appId}, ${member.user_id}, ${member.email},
        ${member.phone}, ${member.fcm_token}, ${member.onesignal_player_id},
        ${member.entity_id}
      )
      RETURNING id, user_id, email, phone, fcm_token, onesignal_player_id,
                entity_id, created_at, updated_at
    `;
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("[audiences] POST member error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id/members/:memberId", async (req, res) => {
  try {
    if (!validUuid(req.params.memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    const member = normalizeAudienceMember(req.body);
    if (!hasDeliveryAddress(member)) {
      return res.status(400).json({
        error:
          "At least one delivery address is required: email, phone, fcm_token, or onesignal_player_id",
      });
    }
    const rows = await sql`
      UPDATE audience_members
      SET email = ${member.email},
          phone = ${member.phone},
          fcm_token = ${member.fcm_token},
          onesignal_player_id = ${member.onesignal_player_id},
          entity_id = ${member.entity_id},
          updated_at = now()
      WHERE id = ${req.params.memberId}
        AND audience_id = ${audience.id}
        AND app_id = ${req.appId}
      RETURNING id, user_id, email, phone, fcm_token, onesignal_player_id,
                entity_id, created_at, updated_at
    `;
    if (!rows.length) return res.status(404).json({ error: "Member not found" });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("[audiences] PUT member error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/members/:memberId", async (req, res) => {
  try {
    if (!validUuid(req.params.memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }
    const sql = getDb();
    const rows = await sql`
      DELETE FROM audience_members
      WHERE id = ${req.params.memberId}
        AND audience_id = ${req.params.id}
        AND app_id = ${req.appId}
      RETURNING id
    `;
    if (!rows.length) return res.status(404).json({ error: "Member not found" });
    return res.json({ success: true });
  } catch (err) {
    console.error("[audiences] DELETE member error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/members/import", receiveImportFile, async (req, res) => {
  try {
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    if (!req.file) {
      return res.status(400).json({ error: "CSV or JSON file is required" });
    }
    const detectedFormat = req.file.originalname.split(".").pop()?.toLowerCase();
    const format = String(req.body?.format || detectedFormat || "").toLowerCase();
    const mode = String(req.body?.mode || "append").toLowerCase();
    if (!["append", "replace"].includes(mode)) {
      return res.status(400).json({ error: "mode must be append or replace" });
    }

    let source;
    try {
      source = parseAudienceImport(format, req.file.buffer.toString("utf8"));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (source.length > MAX_IMPORT_ROWS) {
      return res.status(413).json({
        error: `Import is limited to ${MAX_IMPORT_ROWS} rows per file`,
      });
    }

    const members = [];
    const errors = [];
    source.forEach((raw, index) => {
      const member = normalizeAudienceMember(raw);
      if (hasDeliveryAddress(member)) members.push(member);
      else if (errors.length < 100) {
        errors.push({
          row: index + (format === "csv" ? 2 : 1),
          error: "No delivery address",
        });
      }
    });

    const client = await sql.raw.connect();
    let imported = 0;
    try {
      await client.query("BEGIN");
      if (mode === "replace") {
        await client.query(
          "DELETE FROM audience_members WHERE audience_id = $1 AND app_id = $2",
          [audience.id, req.appId],
        );
      }
      for (let start = 0; start < members.length; start += 500) {
        const batch = members.slice(start, start + 500);
        const params = [];
        const values = batch.map((member, index) => {
          const base = index * 8;
          params.push(audience.id, req.appId, ...memberValues(member));
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
        });
        const result = await client.query(
          `INSERT INTO audience_members (
             audience_id, app_id, user_id, email, phone, fcm_token,
             onesignal_player_id, entity_id
           ) VALUES ${values.join(",")}
           ON CONFLICT (audience_id, user_id) DO UPDATE SET
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             fcm_token = EXCLUDED.fcm_token,
             onesignal_player_id = EXCLUDED.onesignal_player_id,
             entity_id = EXCLUDED.entity_id,
             updated_at = now()`,
          params,
        );
        imported += result.rowCount;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      imported,
      skipped: source.length - members.length,
      errors,
    });
  } catch (err) {
    console.error("[audiences] import error:", err);
    return res.status(500).json({ error: "Import failed" });
  }
});

router.get("/:id/members/export", async (req, res) => {
  try {
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });
    const format = String(req.query.format || "csv").toLowerCase();
    if (!["csv", "json"].includes(format)) {
      return res.status(400).json({ error: "format must be csv or json" });
    }
    const members = await sql`
      SELECT email, phone, fcm_token, onesignal_player_id, entity_id
      FROM audience_members
      WHERE audience_id = ${audience.id} AND app_id = ${req.appId}
      ORDER BY created_at ASC, id ASC
    `;
    const filename = `audience-${audience.id}.${format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (format === "json") {
      return res.type("application/json").send(
        JSON.stringify(
          members.map((member) =>
            Object.fromEntries(
              AUDIENCE_MEMBER_FIELDS.map((field) => [
                field,
                member[field] || "",
              ]),
            ),
          ),
          null,
          2,
        ),
      );
    }
    return res.type("text/csv").send(membersToCsv(members));
  } catch (err) {
    console.error("[audiences] export error:", err);
    return res.status(500).json({ error: "Export failed" });
  }
});

router.post("/:id/notify", async (req, res) => {
  try {
    const sql = getDb();
    const audience = await findAudience(sql, req.appId, req.params.id);
    if (!audience) return res.status(404).json({ error: "Audience not found" });

    const { type, channels, variables, entity_id, parent_entity_id } = req.body;
    if (!type || !Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({
        error: "Required fields: type, channels (non-empty array)",
      });
    }

    let cursor = null;
    let queued = 0;
    let skipped = 0;
    const errors = [];
    const notificationPreparation = new Map();

    for (;;) {
      const members = cursor
        ? await sql`
            SELECT id, user_id, email, phone, fcm_token,
                   onesignal_player_id, entity_id
            FROM audience_members
            WHERE audience_id = ${audience.id}
              AND app_id = ${req.appId}
              AND id > ${cursor}
            ORDER BY id ASC
            LIMIT ${BROADCAST_PAGE_SIZE}
          `
        : await sql`
            SELECT id, user_id, email, phone, fcm_token,
                   onesignal_player_id, entity_id
            FROM audience_members
            WHERE audience_id = ${audience.id} AND app_id = ${req.appId}
            ORDER BY id ASC
            LIMIT ${BROADCAST_PAGE_SIZE}
          `;
      if (!members.length) break;

      for (let start = 0; start < members.length; start += BROADCAST_CONCURRENCY) {
        const batch = members.slice(start, start + BROADCAST_CONCURRENCY);
        const results = await Promise.all(
          batch.map((member) =>
            invokeNotifyHandler(
              req,
              {
                user_id: member.user_id,
                type,
                channels,
                variables,
                user: {
                  ...(member.email ? { email: member.email } : {}),
                  ...(member.phone ? { phone: member.phone } : {}),
                  ...(member.fcm_token ? { fcm_token: member.fcm_token } : {}),
                  ...(member.onesignal_player_id
                    ? { onesignal_player_id: member.onesignal_player_id }
                    : {}),
                },
                entity_id: member.entity_id || entity_id,
                parent_entity_id,
              },
              notificationPreparation,
            ),
          ),
        );
        results.forEach((result, index) => {
          if (result.status >= 200 && result.status < 300) queued += 1;
          else {
            skipped += 1;
            if (errors.length < 25) {
              errors.push({
                member_id: batch[index].id,
                error: result.body?.error || "Notification was not queued",
              });
            }
          }
        });
      }

      cursor = members[members.length - 1].id;
      if (members.length < BROADCAST_PAGE_SIZE) break;
    }

    if (queued === 0 && skipped === 0) {
      return res.status(400).json({ error: "This audience has no members" });
    }
    return res.status(202).json({
      success: queued > 0,
      broadcast: true,
      audience_id: audience.id,
      queued,
      skipped,
      errors,
    });
  } catch (err) {
    console.error("[audiences] notify error:", err);
    return res.status(500).json({ error: "Audience broadcast failed" });
  }
});

function invokeNotifyHandler(parentReq, body, notificationPreparation) {
  return new Promise((resolve) => {
    let status = 200;
    const response = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        resolve({ status, body: payload });
        return this;
      },
    };
    Promise.resolve(
      notifyHandler(
        {
          ...parentReq,
          body,
          appId: parentReq.appId,
          notificationPreparation,
        },
        response,
      ),
    ).catch((error) =>
      resolve({ status: 500, body: { error: error.message } }),
    );
  });
}

module.exports = router;
