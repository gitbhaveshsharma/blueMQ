const { Router } = require("express");
const { getDb } = require("../../db");
const axios = require("axios");

const router = Router();

const META_GRAPH_BASE = "https://graph.facebook.com";
const META_API_VERSION = "v19.0";

// ─── Helpers ───────────────────────────────────────────────

/**
 * Resolve the Meta Business Account ID and API key for an app.
 * Looks up the first active WhatsApp session for the app.
 */
async function resolveMetaCredentials(appId, entityId) {
  const sql = getDb();

  let rows;
  if (entityId) {
    rows = await sql`
      SELECT meta_api_key, meta_business_account_id, meta_phone_number_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
        AND status = 'active'
      LIMIT 1
    `;
  }

  if (!rows || rows.length === 0) {
    rows = await sql`
      SELECT meta_api_key, meta_business_account_id, meta_phone_number_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId}
        AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1
    `;
  }

  if (!rows || rows.length === 0) {
    return null;
  }

  return rows[0];
}

/**
 * Extract variable placeholders from Meta template components.
 * Meta templates use {{1}}, {{2}}, ... positional params in BODY components.
 */
function extractMetaTemplateVars(components) {
  const vars = [];
  for (const comp of components || []) {
    if (comp.type === "BODY" && comp.text) {
      const matches = comp.text.match(/\{\{(\d+)\}\}/g) || [];
      for (const match of matches) {
        const idx = parseInt(match.replace(/[{}]/g, ""), 10);
        if (!vars.find((v) => v.index === idx)) {
          vars.push({ index: idx, placeholder: match, key: `var_${idx}` });
        }
      }
    }
    if (comp.type === "HEADER" && comp.text) {
      const matches = comp.text.match(/\{\{(\d+)\}\}/g) || [];
      for (const match of matches) {
        const idx = parseInt(match.replace(/[{}]/g, ""), 10);
        if (!vars.find((v) => v.index === idx)) {
          vars.push({
            index: idx,
            placeholder: match,
            key: `header_var_${idx}`,
          });
        }
      }
    }
  }
  return vars.sort((a, b) => a.index - b.index);
}

// ─── GET /whatsapp-templates ─────────────────────────────────
/**
 * List all approved WhatsApp message templates from Meta.
 * Proxies to: GET /v19.0/{waba_id}/message_templates
 *
 * Query params:
 *   ?entity_id=<entity>    optional — which WhatsApp session to use
 *   &name=<search>         optional — filter by name
 *   &status=APPROVED       optional — default: APPROVED
 */
router.get("/", async (req, res) => {
  try {
    const appId = req.appId;
    const { entity_id, name, status = "APPROVED", limit = 20 } = req.query;

    const creds = await resolveMetaCredentials(appId, entity_id);
    if (!creds) {
      return res.status(404).json({
        error:
          "No active WhatsApp session found. Configure a WhatsApp session first.",
      });
    }

    if (!creds.meta_business_account_id) {
      return res.status(422).json({
        error:
          "WhatsApp session is missing meta_business_account_id. Update your session configuration.",
      });
    }

    const params = { status, limit };
    if (name) params.name = name;

    const response = await axios.get(
      `${META_GRAPH_BASE}/${META_API_VERSION}/${creds.meta_business_account_id}/message_templates`,
      {
        headers: { Authorization: `Bearer ${creds.meta_api_key}` },
        params,
        timeout: 15000,
      },
    );

    const templates = (response.data?.data || []).map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      components: t.components,
      variables: extractMetaTemplateVars(t.components),
      body_text: t.components?.find((c) => c.type === "BODY")?.text || "",
      header_text: t.components?.find((c) => c.type === "HEADER")?.text || "",
      footer_text: t.components?.find((c) => c.type === "FOOTER")?.text || "",
    }));

    return res.json({ success: true, data: templates });
  } catch (err) {
    if (err.response) {
      const metaError = err.response.data?.error;
      console.error("[whatsapp-templates] Meta API error:", metaError);
      return res.status(err.response.status || 502).json({
        error:
          metaError?.message ||
          `Meta API returned ${err.response.status}`,
      });
    }
    console.error("[whatsapp-templates] GET / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /whatsapp-templates/:name ───────────────────────────
/**
 * Get a single WhatsApp template by name.
 * Returns template with parsed variables.
 *
 * Query params:
 *   ?entity_id=<entity>   optional
 */
router.get("/:name", async (req, res) => {
  try {
    const appId = req.appId;
    const { name } = req.params;
    const { entity_id } = req.query;

    const creds = await resolveMetaCredentials(appId, entity_id);
    if (!creds) {
      return res.status(404).json({
        error:
          "No active WhatsApp session found. Configure a WhatsApp session first.",
      });
    }

    if (!creds.meta_business_account_id) {
      return res.status(422).json({
        error:
          "WhatsApp session is missing meta_business_account_id. Update your session configuration.",
      });
    }

    const response = await axios.get(
      `${META_GRAPH_BASE}/${META_API_VERSION}/${creds.meta_business_account_id}/message_templates`,
      {
        headers: { Authorization: `Bearer ${creds.meta_api_key}` },
        params: { name, status: "APPROVED", limit: 5 },
        timeout: 15000,
      },
    );

    const templates = response.data?.data || [];
    if (templates.length === 0) {
      return res.status(404).json({
        error: `No approved template named "${name}" found in your WhatsApp Business Account`,
      });
    }

    const t = templates[0];
    return res.json({
      success: true,
      data: {
        id: t.id,
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        components: t.components,
        variables: extractMetaTemplateVars(t.components),
        body_text:
          t.components?.find((c) => c.type === "BODY")?.text || "",
        header_text:
          t.components?.find((c) => c.type === "HEADER")?.text || "",
        footer_text:
          t.components?.find((c) => c.type === "FOOTER")?.text || "",
      },
    });
  } catch (err) {
    if (err.response) {
      const metaError = err.response.data?.error;
      console.error("[whatsapp-templates] Meta API error:", metaError);
      return res.status(err.response.status || 502).json({
        error:
          metaError?.message ||
          `Meta API returned ${err.response.status}`,
      });
    }
    console.error("[whatsapp-templates] GET /:name error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
