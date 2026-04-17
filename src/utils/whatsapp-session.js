function normalizeEntityId(entityId) {
  return String(entityId ?? "").trim();
}

async function findWhatsAppSessionByEntity(sql, appId, entityId) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) return null;

  const result = await sql.query(
    `
      SELECT
        entity_id,
        parent_entity_id,
        waha_session AS session_name,
        waha_session,
        phone_number,
        status,
        qr_code,
        connected_at,
        disconnected_at,
        created_at,
        connection_type,
        meta_api_key,
        meta_phone_number_id,
        meta_business_account_id
      FROM whatsapp_sessions
      WHERE app_id = $1
        AND entity_id = $2
      LIMIT 1
    `,
    [appId, normalizedEntityId],
  );

  return result.rows[0] ?? null;
}

async function resolveWhatsAppSession(
  sql,
  { appId, entityId, parentEntityId },
) {
  const directSession = await findWhatsAppSessionByEntity(sql, appId, entityId);
  if (directSession && directSession.status === "active") {
    return {
      session: directSession,
      resolvedEntityId: directSession.entity_id,
      isInherited: false,
    };
  }

  const normalizedParentEntityId = normalizeEntityId(parentEntityId);
  if (normalizedParentEntityId) {
    const parentSession = await findWhatsAppSessionByEntity(
      sql,
      appId,
      normalizedParentEntityId,
    );

    if (parentSession && parentSession.status === "active") {
      return {
        session: parentSession,
        resolvedEntityId: parentSession.entity_id,
        isInherited: true,
      };
    }
  }

  return {
    session: directSession,
    resolvedEntityId: directSession?.entity_id ?? null,
    isInherited: false,
  };
}

module.exports = {
  normalizeEntityId,
  findWhatsAppSessionByEntity,
  resolveWhatsAppSession,
};
