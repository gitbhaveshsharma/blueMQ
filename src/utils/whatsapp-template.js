const axios = require("axios");
const { getDb } = require("../db");
const {
  META_GRAPH_BASE,
  META_API_VERSION,
  META_GRAPH_TIMEOUT_MS,
  META_RATE_LIMIT_RETRIES,
  META_RATE_LIMIT_BASE_DELAY_MS,
} = require("../config/meta-graph");

const SENDABLE_STATUSES = Object.freeze(["APPROVED"]);
const META_TEMPLATE_FIELDS =
  "id,name,language,status,category,components,last_updated_time";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const COMPONENT_ORDER = Object.freeze({ HEADER: 0, BODY: 1, BUTTON: 2 });

function placeholderIndexes(text) {
  return (String(text || "").match(/\{\{(\d+)\}\}/g) || []).map((match) =>
    parseInt(match.replace(/[{}]/g, ""), 10),
  );
}

/** Highest {{n}} used by a template's header/body text. */
function maxTextIndex(components) {
  let max = 0;
  for (const comp of components || []) {
    if ((comp.type === "BODY" || comp.type === "HEADER") && comp.text) {
      for (const index of placeholderIndexes(comp.text)) {
        max = Math.max(max, index);
      }
    }
  }
  return max;
}

/**
 * Buttons that need their own send parameter: URL buttons with a placeholder
 * suffix and copy-code buttons. Meta numbers each button's variable from
 * {{1}}, so BlueMQ continues the header/body numbering to keep callers on a
 * single flat list of positional values.
 */
function dynamicButtonSlots(components) {
  const slots = [];
  let nextIndex = maxTextIndex(components);

  for (const comp of components || []) {
    if (comp.type !== "BUTTONS") continue;
    (comp.buttons || []).forEach((button, buttonIndex) => {
      const subType = String(button.type || "").toUpperCase();
      const isDynamicUrl =
        subType === "URL" && placeholderIndexes(button.url).length > 0;
      if (!isDynamicUrl && subType !== "COPY_CODE") return;

      nextIndex += 1;
      slots.push({
        index: nextIndex,
        buttonIndex,
        subType,
        text: button.text || "",
      });
    });
  }

  return slots;
}

function extractMetaTemplateVars(components) {
  const vars = [];
  for (const comp of components || []) {
    if ((comp.type === "BODY" || comp.type === "HEADER") && comp.text) {
      const matches = comp.text.match(/\{\{(\d+)\}\}/g) || [];
      for (const match of matches) {
        const idx = parseInt(match.replace(/[{}]/g, ""), 10);
        if (!vars.find((v) => v.index === idx && v.component === comp.type)) {
          vars.push({
            index: idx,
            placeholder: match,
            key: `${comp.type === "HEADER" ? "header_var" : "var"}_${idx}`,
            component: comp.type,
          });
        }
      }
    }
  }

  for (const slot of dynamicButtonSlots(components)) {
    vars.push({
      index: slot.index,
      placeholder: `{{${slot.index}}}`,
      key: `button_${slot.buttonIndex + 1}_var`,
      component: "BUTTON",
      button_index: slot.buttonIndex,
      button_sub_type: slot.subType,
      button_text: slot.text,
    });
  }

  return vars.sort((a, b) => {
    if (a.component !== b.component) {
      return COMPONENT_ORDER[a.component] - COMPONENT_ORDER[b.component];
    }
    return a.index - b.index;
  });
}

function extractPreview(components) {
  const list = Array.isArray(components) ? components : [];
  const header = list.find((c) => c.type === "HEADER");
  const body = list.find((c) => c.type === "BODY");
  const footer = list.find((c) => c.type === "FOOTER");
  const buttonsComp = list.find((c) => c.type === "BUTTONS");
  return {
    headerText: header?.text || "",
    bodyText: body?.text || "",
    footerText: footer?.text || "",
    buttons: buttonsComp?.buttons || [],
  };
}

function mapMetaTemplate(t) {
  const components = t.components || [];
  const preview = extractPreview(components);
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
    components,
    variables: extractMetaTemplateVars(components),
    body_text: preview.bodyText,
    header_text: preview.headerText,
    footer_text: preview.footerText,
    last_updated_time: t.last_updated_time || null,
  };
}

function parseComponentsPayload(value) {
  if (Array.isArray(value)) {
    return { components: value };
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value.components)) {
      return { components: value.components, envelope: value };
    }
    return { error: "JSON must include a components array" };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { error: "components are required" };
  }
  try {
    const parsed = JSON.parse(value);
    return parseComponentsPayload(parsed);
  } catch {
    return { error: "Invalid JSON" };
  }
}

function buildComponentsFromPlainText({ headerText, body, footerText, buttons }) {
  const components = [];
  if (headerText && String(headerText).trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: String(headerText).trim(),
    });
  }
  components.push({
    type: "BODY",
    text: String(body || "").trim(),
  });
  if (footerText && String(footerText).trim()) {
    components.push({
      type: "FOOTER",
      text: String(footerText).trim(),
    });
  }
  if (Array.isArray(buttons) && buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons });
  }
  return components;
}

function positionalValues(variables) {
  if (!variables || typeof variables !== "object") {
    return [];
  }
  if (Array.isArray(variables.whatsapp)) {
    return variables.whatsapp.map((v) => String(v ?? ""));
  }
  if (Array.isArray(variables.params)) {
    return variables.params.map((v) => String(v ?? ""));
  }
  const keys = Object.keys(variables).filter((k) => /^\d+$/.test(k));
  if (keys.length === 0) {
    return [];
  }
  keys.sort((a, b) => Number(a) - Number(b));
  return keys.map((k) => String(variables[k] ?? ""));
}

function parametersForPlaceholders(text, valuesByIndex) {
  const matches = String(text || "").match(/\{\{(\d+)\}\}/g) || [];
  const params = [];
  const seen = new Set();
  for (const match of matches) {
    const idx = parseInt(match.replace(/[{}]/g, ""), 10);
    if (seen.has(idx)) continue;
    seen.add(idx);
    const textValue = valuesByIndex[idx] ?? valuesByIndex[String(idx)] ?? "";
    params.push({ type: "text", text: String(textValue) });
  }
  return params;
}

function buildTemplateSendComponents(components, variables) {
  const ordered = positionalValues(variables);
  const valuesByIndex = {};
  ordered.forEach((text, i) => {
    valuesByIndex[i + 1] = text;
  });
  Object.keys(variables || {}).forEach((key) => {
    if (/^\d+$/.test(key)) {
      valuesByIndex[Number(key)] = String(variables[key] ?? "");
    }
  });

  const sendComponents = [];
  for (const comp of components || []) {
    if (comp.type === "HEADER" && comp.format === "TEXT" && comp.text) {
      const parameters = parametersForPlaceholders(comp.text, valuesByIndex);
      if (parameters.length > 0) {
        sendComponents.push({ type: "header", parameters });
      }
    }
    if (comp.type === "BODY" && comp.text) {
      const parameters = parametersForPlaceholders(comp.text, valuesByIndex);
      if (parameters.length > 0) {
        sendComponents.push({ type: "body", parameters });
      }
    }
  }

  // Meta rejects the whole send (#131008) when a dynamic button has no value.
  for (const slot of dynamicButtonSlots(components)) {
    const value = String(valuesByIndex[slot.index] ?? "");
    sendComponents.push(
      slot.subType === "COPY_CODE"
        ? {
            type: "button",
            sub_type: "copy_code",
            index: String(slot.buttonIndex),
            parameters: [{ type: "coupon_code", coupon_code: value }],
          }
        : {
            type: "button",
            sub_type: "url",
            index: String(slot.buttonIndex),
            parameters: [{ type: "text", text: value }],
          },
    );
  }

  return sendComponents;
}

function normalizeComponents(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : parsed?.components || [];
    } catch {
      return [];
    }
  }
  if (value && Array.isArray(value.components)) return value.components;
  return [];
}

function isSendableStatus(status) {
  return SENDABLE_STATUSES.includes(String(status || "").toUpperCase());
}

function parseMetaUpdatedAt(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function componentsEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function inferCacheStatusFromMetaError(errorCode, message) {
  const msg = String(message || "").toLowerCase();
  const code = Number(errorCode);
  if (
    code === 132015 ||
    msg.includes("paused") ||
    msg.includes("disabled")
  ) {
    return "PAUSED";
  }
  if (
    code === 132001 ||
    msg.includes("delete") ||
    msg.includes("does not exist") ||
    msg.includes("not found") ||
    msg.includes("not exist")
  ) {
    return "DELETED";
  }
  return null;
}

async function resolveMetaCredentials(appId, entityId) {
  const sql = getDb();
  let rows;
  if (entityId) {
    rows = await sql`
      SELECT
        entity_id,
        meta_api_key,
        meta_business_account_id,
        meta_phone_number_id
      FROM whatsapp_sessions
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
        AND status = 'active'
      LIMIT 1
    `;
  }

  if (!rows || rows.length === 0) {
    rows = await sql`
      SELECT
        entity_id,
        meta_api_key,
        meta_business_account_id,
        meta_phone_number_id
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

async function countActiveWhatsAppSessions(appId) {
  const sql = getDb();
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM whatsapp_sessions
    WHERE app_id = ${appId}
      AND status = 'active'
      AND connection_type = 'meta'
  `;
  return rows[0]?.count || 0;
}

async function resolveSessionForTemplates(appId, entityId) {
  const activeCount = await countActiveWhatsAppSessions(appId);
  if (activeCount > 1 && !entityId) {
    return {
      error: {
        status: 400,
        message:
          "entity_id is required when multiple WhatsApp sessions exist. Pick a session and retry.",
      },
    };
  }

  const creds = await resolveMetaCredentials(appId, entityId);
  if (!creds) {
    return {
      error: {
        status: 404,
        message:
          "No active WhatsApp session found. Configure a WhatsApp session first.",
      },
    };
  }
  if (!creds.meta_business_account_id) {
    return {
      error: {
        status: 422,
        message:
          "WhatsApp session is missing meta_business_account_id. Update your session configuration.",
      },
    };
  }

  return {
    creds,
    entityId: creds.entity_id,
    activeCount,
  };
}

function graphUrl(path) {
  return `${META_GRAPH_BASE}/${META_API_VERSION}/${path}`;
}

async function graphRequest({ method, path, token, params, data }) {
  let lastError;
  for (let attempt = 0; attempt <= META_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await axios({
        method,
        url: graphUrl(path),
        headers: { Authorization: `Bearer ${token}` },
        params,
        data,
        timeout: META_GRAPH_TIMEOUT_MS,
      });
      return { data: response.data };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 429 && attempt < META_RATE_LIMIT_RETRIES) {
        await sleep(META_RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      break;
    }
  }
  return { error: lastError };
}

function formatMetaAxiosError(err) {
  const metaError = err?.response?.data?.error;
  return {
    status: err?.response?.status || 502,
    message:
      metaError?.message ||
      (err?.response?.status
        ? `Meta API returned ${err.response.status}`
        : err?.message || "Meta API error"),
    code: metaError?.code || null,
  };
}

async function fetchAllMessageTemplates({ creds, status }) {
  const collected = [];
  let after;
  let truncated = false;
  let rateLimitError = null;

  while (true) {
    const params = {
      fields: META_TEMPLATE_FIELDS,
      limit: 100,
    };
    if (status) params.status = status;
    if (after) params.after = after;

    const { data, error } = await graphRequest({
      method: "get",
      path: `${creds.meta_business_account_id}/message_templates`,
      token: creds.meta_api_key,
      params,
    });

    if (error) {
      const formatted = formatMetaAxiosError(error);
      if (error.response?.status === 429) {
        truncated = true;
        rateLimitError = formatted.message;
        break;
      }
      return { templates: collected, truncated: false, error: formatted };
    }

    const page = data?.data || [];
    collected.push(...page.map(mapMetaTemplate));

    const nextAfter = data?.paging?.cursors?.after;
    if (!nextAfter || page.length === 0) {
      break;
    }
    after = nextAfter;
  }

  return {
    templates: collected,
    truncated,
    error: rateLimitError ? { status: 429, message: rateLimitError } : null,
  };
}

async function listLiveTemplates({ creds, name, status, limit }) {
  const params = {
    fields: META_TEMPLATE_FIELDS,
    limit: Number(limit) > 0 ? Number(limit) : 20,
  };
  if (status) params.status = status;
  if (name) params.name = name;

  const { data, error } = await graphRequest({
    method: "get",
    path: `${creds.meta_business_account_id}/message_templates`,
    token: creds.meta_api_key,
    params,
  });

  if (error) {
    return { error: formatMetaAxiosError(error), templates: [] };
  }

  return { templates: (data?.data || []).map(mapMetaTemplate) };
}

async function createMessageTemplate({ creds, name, language, category, components }) {
  const { data, error } = await graphRequest({
    method: "post",
    path: `${creds.meta_business_account_id}/message_templates`,
    token: creds.meta_api_key,
    data: { name, language, category, components },
  });

  if (error) {
    return { error: formatMetaAxiosError(error) };
  }

  return { data };
}

function toCacheRow(mapped, { appId, entityId }) {
  return {
    app_id: appId,
    entity_id: entityId,
    meta_id: mapped.id || null,
    name: mapped.name,
    language: mapped.language,
    status: mapped.status || "UNKNOWN",
    category: mapped.category || null,
    components: mapped.components || [],
    last_updated_time: parseMetaUpdatedAt(mapped.last_updated_time),
  };
}

async function upsertCacheRow(row) {
  const sql = getDb();
  const componentsJson = JSON.stringify(row.components || []);
  try {
    const result = await sql`
      INSERT INTO whatsapp_meta_templates (
        app_id,
        entity_id,
        meta_id,
        name,
        language,
        status,
        category,
        components,
        last_updated_time,
        cached_at
      )
      VALUES (
        ${row.app_id},
        ${row.entity_id},
        ${row.meta_id},
        ${row.name},
        ${row.language},
        ${row.status},
        ${row.category},
        ${componentsJson},
        ${row.last_updated_time},
        now()
      )
      ON CONFLICT (app_id, entity_id, name, language)
      DO UPDATE SET
        meta_id = EXCLUDED.meta_id,
        status = EXCLUDED.status,
        category = EXCLUDED.category,
        components = EXCLUDED.components,
        last_updated_time = EXCLUDED.last_updated_time,
        cached_at = now()
      RETURNING *
    `;
    return { row: result[0], cached: true };
  } catch (err) {
    console.error("[whatsapp-template] cache upsert failed:", err.message);
    return { row: null, cached: false, error: err };
  }
}

function shouldUpdateCache(existing, incoming) {
  if (!existing) return "insert";
  const incomingTime = incoming.last_updated_time
    ? new Date(incoming.last_updated_time).getTime()
    : null;
  const existingTime = existing.last_updated_time
    ? new Date(existing.last_updated_time).getTime()
    : null;
  if (
    incomingTime &&
    existingTime &&
    incomingTime <= existingTime &&
    componentsEqual(existing.components, incoming.components) &&
    String(existing.status) === String(incoming.status)
  ) {
    return "skip";
  }
  if (
    !incomingTime &&
    componentsEqual(existing.components, incoming.components) &&
    String(existing.status) === String(incoming.status) &&
    String(existing.category || "") === String(incoming.category || "")
  ) {
    return "skip";
  }
  return "update";
}

async function listCachedTemplates({ appId, entityId, name }) {
  const sql = getDb();
  if (entityId && name) {
    return sql`
      SELECT * FROM whatsapp_meta_templates
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
        AND name = ${name}
      ORDER BY language ASC
    `;
  }
  if (entityId) {
    return sql`
      SELECT * FROM whatsapp_meta_templates
      WHERE app_id = ${appId}
        AND entity_id = ${entityId}
      ORDER BY name ASC, language ASC
    `;
  }
  if (name) {
    return sql`
      SELECT * FROM whatsapp_meta_templates
      WHERE app_id = ${appId}
        AND name = ${name}
      ORDER BY entity_id ASC, language ASC
    `;
  }
  return sql`
    SELECT * FROM whatsapp_meta_templates
    WHERE app_id = ${appId}
    ORDER BY entity_id ASC, name ASC, language ASC
  `;
}

async function findCachedSendableTemplate({
  appId,
  entityId,
  parentEntityId,
  name,
  language,
}) {
  const sql = getDb();
  const entityCandidates = [entityId, parentEntityId].filter(Boolean);

  for (const entity of entityCandidates) {
    const rows = language
      ? await sql`
          SELECT * FROM whatsapp_meta_templates
          WHERE app_id = ${appId}
            AND entity_id = ${entity}
            AND name = ${name}
            AND language = ${language}
          LIMIT 1
        `
      : await sql`
          SELECT * FROM whatsapp_meta_templates
          WHERE app_id = ${appId}
            AND entity_id = ${entity}
            AND name = ${name}
          ORDER BY language ASC
        `;

    const sendable = rows.filter((row) => isSendableStatus(row.status));
    if (sendable.length > 0) {
      return sendable[0];
    }
    if (rows.length > 0) {
      return rows[0];
    }
  }

  return null;
}

async function markCacheStatus({ appId, entityId, name, language, status }) {
  if (!appId || !entityId || !name || !language || !status) return;
  const sql = getDb();
  await sql`
    UPDATE whatsapp_meta_templates
    SET status = ${status}, cached_at = now()
    WHERE app_id = ${appId}
      AND entity_id = ${entityId}
      AND name = ${name}
      AND language = ${language}
  `;
}

async function syncMetaTemplates({ appId, entityId }) {
  const resolved = await resolveSessionForTemplates(appId, entityId);
  if (resolved.error) {
    return { error: resolved.error };
  }

  const { creds, entityId: resolvedEntityId } = resolved;
  const fetched = await fetchAllMessageTemplates({ creds, status: null });
  if (fetched.error && fetched.templates.length === 0) {
    return { error: fetched.error };
  }

  const sql = getDb();
  const existingRows = await sql`
    SELECT name, language, status, category, components, last_updated_time
    FROM whatsapp_meta_templates
    WHERE app_id = ${appId}
      AND entity_id = ${resolvedEntityId}
  `;
  const existingMap = new Map(
    existingRows.map((row) => [`${row.name}::${row.language}`, row]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const seenKeys = new Set();

  for (const mapped of fetched.templates) {
    const key = `${mapped.name}::${mapped.language}`;
    seenKeys.add(key);
    const incoming = toCacheRow(mapped, {
      appId,
      entityId: resolvedEntityId,
    });
    const action = shouldUpdateCache(existingMap.get(key), incoming);
    if (action === "skip") {
      skipped += 1;
      continue;
    }
    const result = await upsertCacheRow(incoming);
    if (!result.cached) {
      continue;
    }
    if (action === "insert") created += 1;
    else updated += 1;
  }

  let pruned = 0;
  if (!fetched.truncated) {
    for (const [key, row] of existingMap.entries()) {
      if (seenKeys.has(key)) continue;
      if (String(row.status).toUpperCase() === "DELETED") continue;
      await sql`
        UPDATE whatsapp_meta_templates
        SET status = 'DELETED', cached_at = now()
        WHERE app_id = ${appId}
          AND entity_id = ${resolvedEntityId}
          AND name = ${row.name}
          AND language = ${row.language}
      `;
      pruned += 1;
    }
  }

  return {
    entityId: resolvedEntityId,
    created,
    updated,
    skipped,
    pruned,
    total: fetched.templates.length,
    truncated: fetched.truncated,
    error: fetched.error?.message || null,
  };
}

function buildWhatsAppSendTemplate({ cacheRow, type, variables, fallback }) {
  if (cacheRow && isSendableStatus(cacheRow.status)) {
    const components = normalizeComponents(cacheRow.components);
    const preview = extractPreview(components);
    return {
      title: preview.headerText || cacheRow.name,
      body: preview.bodyText || type,
      bodyFormat: "text",
      ctaText: null,
      actionUrl: null,
      templateName: cacheRow.name,
      language: cacheRow.language,
      parameters: buildTemplateSendComponents(components, variables),
    };
  }
  return fallback;
}

function presentCacheRow(row) {
  if (!row) return null;
  const components = normalizeComponents(row.components);
  const preview = extractPreview(components);
  return {
    id: row.id,
    entity_id: row.entity_id,
    meta_id: row.meta_id,
    name: row.name,
    language: row.language,
    status: row.status,
    category: row.category,
    components,
    variables: extractMetaTemplateVars(components),
    body_text: preview.bodyText,
    header_text: preview.headerText,
    footer_text: preview.footerText,
    last_updated_time: row.last_updated_time,
    cached_at: row.cached_at,
    channel: "whatsapp",
    type: row.name,
    title: preview.headerText || row.name,
    source: "meta",
  };
}

module.exports = {
  normalizeComponents,
  extractMetaTemplateVars,
  extractPreview,
  mapMetaTemplate,
  parseComponentsPayload,
  buildComponentsFromPlainText,
  positionalValues,
  buildTemplateSendComponents,
  isSendableStatus,
  inferCacheStatusFromMetaError,
  resolveMetaCredentials,
  countActiveWhatsAppSessions,
  resolveSessionForTemplates,
  fetchAllMessageTemplates,
  listLiveTemplates,
  createMessageTemplate,
  upsertCacheRow,
  toCacheRow,
  listCachedTemplates,
  findCachedSendableTemplate,
  markCacheStatus,
  syncMetaTemplates,
  presentCacheRow,
  buildWhatsAppSendTemplate,
  formatMetaAxiosError,
};
