const { getDb } = require("../db");
const {
  normalizePublicChannel,
  getTemplateChannelCandidates,
} = require("./channel");

const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

function normalizeTemplateName(value) {
  return String(value || "").trim().toLowerCase();
}

function entityScopeForChannel(channel, entityId) {
  return channel === "whatsapp" ? String(entityId || "").trim() : "";
}

function validateAliasInput(channel, notificationType, resolvesTo) {
  const normalizedChannel = normalizePublicChannel(channel);
  const notification_type = normalizeTemplateName(notificationType);
  const resolves_to = normalizeTemplateName(resolvesTo);

  if (!normalizedChannel) return { error: "A valid channel is required" };
  if (!notification_type || !resolves_to) {
    return { error: "notification_type and resolves_to are required" };
  }
  if (
    !TEMPLATE_NAME_RE.test(notification_type) ||
    !TEMPLATE_NAME_RE.test(resolves_to)
  ) {
    return {
      error:
        "Template names may contain lowercase letters, numbers, and underscores only",
    };
  }
  if (notification_type === resolves_to) {
    return { error: "An alias cannot resolve to itself" };
  }
  return {
    channel: normalizedChannel,
    notification_type,
    resolves_to,
  };
}

async function listTemplateAliases({ appId, channel, entityId }) {
  const sql = getDb();
  const normalizedChannel = channel
    ? normalizePublicChannel(channel)
    : null;

  if (normalizedChannel) {
    const scope = entityScopeForChannel(normalizedChannel, entityId);
    return sql`
      SELECT *
      FROM template_alias
      WHERE app_id = ${appId}
        AND channel = ${normalizedChannel}
        AND entity_id = ${scope}
      ORDER BY notification_type ASC
    `;
  }

  const whatsappScope = String(entityId || "").trim();
  if (!whatsappScope) {
    // No entity chosen yet (e.g. the Send page before an entity is typed) —
    // return every alias so the UI can still show what a type resolves to.
    return sql`
      SELECT *
      FROM template_alias
      WHERE app_id = ${appId}
      ORDER BY channel ASC, notification_type ASC
    `;
  }

  return sql`
    SELECT *
    FROM template_alias
    WHERE app_id = ${appId}
      AND (
        channel <> 'whatsapp'
        OR entity_id = ${whatsappScope}
      )
    ORDER BY channel ASC, notification_type ASC
  `;
}

async function saveTemplateAlias({
  id,
  appId,
  channel,
  entityId,
  notificationType,
  resolvesTo,
}) {
  const sql = getDb();
  const scope = entityScopeForChannel(channel, entityId);

  if (id) {
    const rows = await sql`
      UPDATE template_alias
      SET
        channel = ${channel},
        entity_id = ${scope},
        notification_type = ${notificationType},
        resolves_to = ${resolvesTo},
        updated_at = now()
      WHERE id = ${id} AND app_id = ${appId}
      RETURNING *
    `;
    return rows[0] || null;
  }

  const rows = await sql`
    INSERT INTO template_alias
      (app_id, channel, entity_id, notification_type, resolves_to)
    VALUES
      (${appId}, ${channel}, ${scope}, ${notificationType}, ${resolvesTo})
    ON CONFLICT (app_id, channel, entity_id, notification_type)
    DO UPDATE SET
      resolves_to = EXCLUDED.resolves_to,
      updated_at = now()
    RETURNING *
  `;
  return rows[0];
}

async function deleteTemplateAlias({ id, appId }) {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM template_alias
    WHERE id = ${id} AND app_id = ${appId}
    RETURNING id
  `;
  return rows[0] || null;
}

async function templateAliasTargetExists({
  appId,
  channel,
  entityId,
  name,
}) {
  const sql = getDb();

  if (channel === "whatsapp") {
    const rows = await sql`
      SELECT 1
      FROM whatsapp_meta_templates
      WHERE app_id = ${appId}
        AND entity_id = ${entityScopeForChannel(channel, entityId)}
        AND name = ${name}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  const candidates = getTemplateChannelCandidates(channel);
  const rows = await sql`
    SELECT 1
    FROM templates
    WHERE app_id = ${appId}
      AND channel = ANY(${candidates})
      AND type = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function resolveTemplateAlias({
  appId,
  channel,
  entityId,
  parentEntityId,
  notificationType,
}) {
  const sql = getDb();
  const normalizedChannel = normalizePublicChannel(channel);
  if (!normalizedChannel) {
    return { templateName: notificationType, aliased: false };
  }

  const scopes =
    normalizedChannel === "whatsapp"
      ? [
          ...new Set(
            [entityId, parentEntityId]
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        ]
      : [""];

  for (const scope of scopes) {
    const rows = await sql`
      SELECT resolves_to
      FROM template_alias
      WHERE app_id = ${appId}
        AND channel = ${normalizedChannel}
        AND entity_id = ${scope}
        AND notification_type = ${notificationType}
      LIMIT 1
    `;
    if (rows[0]?.resolves_to) {
      return {
        templateName: rows[0].resolves_to,
        aliased: true,
        channel: normalizedChannel,
        entityId: scope || null,
      };
    }
  }

  return {
    templateName: notificationType,
    aliased: false,
    channel: normalizedChannel,
    entityId:
      normalizedChannel === "whatsapp"
        ? entityId || parentEntityId || null
        : null,
  };
}

module.exports = {
  validateAliasInput,
  listTemplateAliases,
  saveTemplateAlias,
  deleteTemplateAlias,
  templateAliasTargetExists,
  resolveTemplateAlias,
};
