const { resolveWhatsAppSession } = require("../src/utils/whatsapp-session");

function createSql({ sessions = {}, fallback = null } = {}) {
  return {
    query: jest.fn(async (text, params) => {
      if (text.includes("is_fallback = true")) {
        return { rows: fallback ? [fallback] : [] };
      }
      return { rows: sessions[params[1]] ? [sessions[params[1]]] : [] };
    }),
  };
}

describe("resolveWhatsAppSession", () => {
  test("uses the direct active entity session first", async () => {
    const sql = createSql({
      sessions: {
        branch: { entity_id: "branch", status: "active" },
      },
      fallback: {
        entity_id: "app-default",
        status: "active",
        is_fallback: true,
      },
    });

    const result = await resolveWhatsAppSession(sql, {
      appId: "app-a",
      entityId: "branch",
      parentEntityId: "center",
    });

    expect(result.resolutionSource).toBe("direct");
    expect(result.resolvedEntityId).toBe("branch");
    expect(result.fallbackUsed).not.toBe(true);
  });

  test("walks the stored parent chain before using the app fallback", async () => {
    const sql = createSql({
      sessions: {
        branch: {
          entity_id: "branch",
          parent_entity_id: "center",
          status: "disconnected",
        },
        center: {
          entity_id: "center",
          parent_entity_id: "organization",
          status: "disconnected",
        },
        organization: {
          entity_id: "organization",
          status: "active",
        },
      },
      fallback: {
        entity_id: "app-default",
        status: "active",
        is_fallback: true,
      },
    });

    const result = await resolveWhatsAppSession(sql, {
      appId: "app-a",
      entityId: "branch",
    });

    expect(result.resolutionSource).toBe("parent");
    expect(result.resolvedEntityId).toBe("organization");
    expect(result.fallbackUsed).not.toBe(true);
  });

  test("uses an explicit fallback only after hierarchy lookup fails", async () => {
    const sql = createSql({
      sessions: {
        branch: { entity_id: "branch", status: "disconnected" },
      },
      fallback: {
        entity_id: "app-default",
        status: "active",
        is_fallback: true,
      },
    });

    const result = await resolveWhatsAppSession(sql, {
      appId: "app-a",
      entityId: "branch",
    });

    expect(result.resolutionSource).toBe("app_fallback");
    expect(result.resolvedEntityId).toBe("app-default");
    expect(result.fallbackUsed).toBe(true);
  });

  test("does not resolve a fallback when the app has none", async () => {
    const sql = createSql({
      sessions: {
        branch: { entity_id: "branch", status: "disconnected" },
      },
    });

    const result = await resolveWhatsAppSession(sql, {
      appId: "app-a",
      entityId: "branch",
    });

    expect(result.session).toBeNull();
    expect(result.resolutionSource).toBeNull();
  });
});
