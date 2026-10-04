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
        is_fallback,
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

async function findWhatsAppFallbackSession(sql, appId) {
  const result = await sql.query(
    `
      SELECT
        entity_id,
        parent_entity_id,
        is_fallback,
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
        AND is_fallback = true
        AND status = 'active'
        AND connection_type = 'meta'
      LIMIT 1
    `,
    [appId],
  );

  return result.rows[0] ?? null;
}

async function resolveWhatsAppSession(
  sql,
  { appId, entityId, parentEntityId },
) {
  const requestedEntityId = normalizeEntityId(entityId);
  const explicitParentEntityId = normalizeEntityId(parentEntityId);
  const candidates = [requestedEntityId, explicitParentEntityId];
  const visited = new Set();

  while (candidates.length > 0) {
    const candidate = candidates.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    const candidateSession = await findWhatsAppSessionByEntity(
      sql,
      appId,
      candidate,
    );

    if (candidateSession?.status === "active") {
      return {
        session: candidateSession,
        resolvedEntityId: candidateSession.entity_id,
        isInherited: candidate !== requestedEntityId,
        resolutionSource: candidate === requestedEntityId ? "direct" : "parent",
      };
    }

    if (candidateSession?.parent_entity_id) {
      candidates.push(candidateSession.parent_entity_id);
    }
  }

  const fallbackSession = await findWhatsAppFallbackSession(sql, appId);
  if (fallbackSession) {
    return {
      session: fallbackSession,
      resolvedEntityId: fallbackSession.entity_id,
      isInherited: true,
      fallbackUsed: true,
      resolutionSource: "app_fallback",
    };
  }

  return {
    session: null,
    resolvedEntityId: null,
    isInherited: false,
    fallbackUsed: false,
    resolutionSource: null,
  };
}

module.exports = {
  normalizeEntityId,
  findWhatsAppSessionByEntity,
  findWhatsAppFallbackSession,
  resolveWhatsAppSession,
};
