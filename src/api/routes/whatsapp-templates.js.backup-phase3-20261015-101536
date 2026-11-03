const { Router } = require("express");
const {
  resolveSessionForTemplates,
  listLiveTemplates,
  createMessageTemplate,
  upsertCacheRow,
  toCacheRow,
  listCachedTemplates,
  syncMetaTemplates,
  presentCacheRow,
  mapMetaTemplate,
  parseComponentsPayload,
  extractMetaTemplateVars,
} = require("../../utils/whatsapp-template");

const router = Router();

function sendMetaError(res, formatted) {
  return res.status(formatted.status || 502).json({
    error: formatted.message,
    code: formatted.code || undefined,
  });
}

// POST /whatsapp-templates/sync  (must be before GET /:name)
router.post("/sync", async (req, res) => {
  try {
    const appId = req.appId;
    const entityId = req.query.entity_id || req.body?.entity_id;

    const result = await syncMetaTemplates({ appId, entityId });
    if (result.error && result.total === undefined) {
      return sendMetaError(res, result.error);
    }

    const status = result.truncated ? 207 : 200;
    return res.status(status).json({
      success: !result.truncated,
      data: {
        entity_id: result.entityId,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        pruned: result.pruned,
        total: result.total,
        truncated: result.truncated,
      },
      error: result.error || undefined,
    });
  } catch (err) {
    console.error("[whatsapp-templates] POST /sync error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /whatsapp-templates — create on Meta, then cache
router.post("/", async (req, res) => {
  try {
    const appId = req.appId;
    const {
      entity_id,
      name,
      language,
      category,
      components,
      body,
      header_text,
      footer_text,
      buttons,
    } = req.body || {};

    const resolved = await resolveSessionForTemplates(appId, entity_id);
    if (resolved.error) {
      return sendMetaError(res, resolved.error);
    }

    const trimmedName = String(name || "").trim();
    const trimmedLanguage = String(language || "").trim();
    const trimmedCategory = String(category || "").trim().toUpperCase();

    if (!trimmedName || !trimmedLanguage || !trimmedCategory) {
      return res.status(400).json({
        error: "Required: name, language, category",
      });
    }

    if (!/^[a-z0-9_]+$/.test(trimmedName)) {
      return res.status(400).json({
        error: "Template name must be lowercase letters, numbers, and underscores only",
      });
    }

    let parsedComponents;
    if (components !== undefined && components !== null && components !== "") {
      const parsed = parseComponentsPayload(components);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      parsedComponents = parsed.components;
    } else {
      const bodyText = String(body || "").trim();
      if (!bodyText) {
        return res.status(400).json({
          error: "Required: body (plain text) or components (JSON)",
        });
      }
      parsedComponents = [
        ...(header_text
          ? [{ type: "HEADER", format: "TEXT", text: String(header_text).trim() }]
          : []),
        { type: "BODY", text: bodyText },
        ...(footer_text
          ? [{ type: "FOOTER", text: String(footer_text).trim() }]
          : []),
        ...(Array.isArray(buttons) && buttons.length > 0
          ? [{ type: "BUTTONS", buttons }]
          : []),
      ];
    }

    const hasBody = parsedComponents.some(
      (c) => c.type === "BODY" && String(c.text || "").trim(),
    );
    if (!hasBody) {
      return res.status(400).json({ error: "A BODY component with text is required" });
    }

    const created = await createMessageTemplate({
      creds: resolved.creds,
      name: trimmedName,
      language: trimmedLanguage,
      category: trimmedCategory,
      components: parsedComponents,
    });

    if (created.error) {
      return sendMetaError(res, created.error);
    }

    const mapped = mapMetaTemplate({
      id: created.data?.id,
      name: trimmedName,
      language: trimmedLanguage,
      status: created.data?.status || "PENDING",
      category: trimmedCategory,
      components: parsedComponents,
    });

    const cacheResult = await upsertCacheRow(
      toCacheRow(mapped, { appId, entityId: resolved.entityId }),
    );

    return res.status(201).json({
      success: true,
      cached: cacheResult.cached,
      data: presentCacheRow(
        cacheResult.row || {
          ...mapped,
          entity_id: resolved.entityId,
          meta_id: mapped.id,
        },
      ),
    });
  } catch (err) {
    console.error("[whatsapp-templates] POST / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /whatsapp-templates
// source=cache → BlueMQ cache; default/source=meta → live Graph (Send page)
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id, name, status = "APPROVED", limit = 20, source } = req.query;
    const fromCache = String(source || "").toLowerCase() === "cache";

    if (fromCache) {
      const rows = await listCachedTemplates({
        appId,
        entityId: entity_id,
        name,
      });
      const presented = rows
        .map(presentCacheRow)
        .filter((row) => {
          if (!status) return true;
          if (String(status).toUpperCase() === "ALL") return true;
          return String(row.status).toUpperCase() === String(status).toUpperCase();
        });
      return res.json({ success: true, data: presented });
    }

    const resolved = await resolveSessionForTemplates(appId, entity_id);
    if (resolved.error) {
      return sendMetaError(res, resolved.error);
    }

    const fetched = await listLiveTemplates({
      creds: resolved.creds,
      name,
      status,
      limit,
    });

    if (fetched.error) {
      return sendMetaError(res, fetched.error);
    }

    return res.json({ success: true, data: fetched.templates });
  } catch (err) {
    console.error("[whatsapp-templates] GET / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /whatsapp-templates/:name
router.get("/:name", async (req, res) => {
  try {
    const appId = req.appId;
    const { name } = req.params;
    const { entity_id, source } = req.query;
    const fromCache = String(source || "").toLowerCase() === "cache";

    if (fromCache) {
      const rows = await listCachedTemplates({
        appId,
        entityId: entity_id,
        name,
      });
      if (!rows.length) {
        return res.status(404).json({
          error: `No cached WhatsApp template named "${name}". Sync from Meta first.`,
        });
      }
      return res.json({ success: true, data: presentCacheRow(rows[0]) });
    }

    const resolved = await resolveSessionForTemplates(appId, entity_id);
    if (resolved.error) {
      return sendMetaError(res, resolved.error);
    }

    const fetched = await listLiveTemplates({
      creds: resolved.creds,
      name,
      status: "APPROVED",
      limit: 5,
    });
    if (fetched.error) {
      return sendMetaError(res, fetched.error);
    }

    const match = fetched.templates.find((t) => t.name === name) || fetched.templates[0];
    if (!match) {
      return res.status(404).json({
        error: `No approved template named "${name}" found in your WhatsApp Business Account`,
      });
    }

    return res.json({
      success: true,
      data: {
        ...match,
        variables: extractMetaTemplateVars(match.components),
      },
    });
  } catch (err) {
    console.error("[whatsapp-templates] GET /:name error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
