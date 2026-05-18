/**
 * WebSocket Server
 *
 * Provides real-time notification delivery to connected clients.
 * Clients connect with:
 *   - ws://host:port/ws?api_key=<key>&user_id=<id>
 *   - ws://host:port/api/ws?api_key=<key>&user_id=<id> (compat alias)
 *
 * Architecture:
 *   - Attached to the same HTTP server as Express (no extra port)
 *   - Multi-tenant: each connection is scoped to appId + userId
 *   - Clients map: Map<"appId:userId", Set<ws>>
 *   - Broadcast function exported for use by workers/routes
 *
 * Events sent to clients (JSON):
 *   - { event: "new_notification", data: { ...notification } }
 *   - { event: "notification_deleted", data: { id } }
 *
 * Heartbeat: 30s ping/pong to detect stale connections.
 */

const { WebSocketServer } = require("ws");
const { getDb } = require("../db");

/** @type {Map<string, Set<import("ws").WebSocket>>} */
const clients = new Map();
const WS_PATHS = new Set(["/ws", "/api/ws"]);

/** Normalize and validate acceptable websocket path. */
function normalizeWsPath(pathname) {
  if (!pathname) return null;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return WS_PATHS.has(normalized) ? normalized : null;
}

/** Build a room key from appId + userId */
function roomKey(appId, userId) {
  return `${appId}:${userId}`;
}

/**
 * Validate an API key and return the associated appId.
 * Returns null if invalid.
 */
async function resolveAppId(apiKey) {
  if (!apiKey) return null;

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT app_id FROM apps WHERE api_key = ${apiKey} LIMIT 1
    `;
    return rows.length > 0 ? rows[0].app_id : null;
  } catch (err) {
    console.error("[ws] Auth lookup failed:", err.message);
    return null;
  }
}

/**
 * Attach the WebSocket server to an existing HTTP server.
 *
 * @param {import("http").Server} httpServer
 */
function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const host = req.headers.host || "localhost";

    try {
      const url = new URL(req.url, `http://${host}`);
      if (!normalizeWsPath(url.pathname)) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch (err) {
      console.warn("[ws] Upgrade parse failed:", err.message);
      socket.destroy();
    }
  });

  // ─── Heartbeat ───
  const HEARTBEAT_INTERVAL = 30_000;

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeat));

  // ─── Connection handler ───
  wss.on("connection", async (ws, req) => {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url, `http://${host}`);
    const apiKey = url.searchParams.get("api_key");
    const userId = url.searchParams.get("user_id");

    // 1. Validate
    const appId = await resolveAppId(apiKey);
    if (!appId || !userId) {
      ws.close(4001, "Unauthorized: invalid api_key or missing user_id");
      return;
    }

    // 2. Register in room
    const key = roomKey(appId, userId);
    if (!clients.has(key)) {
      clients.set(key, new Set());
    }
    clients.get(key).add(ws);

    ws.isAlive = true;
    ws.appId = appId;
    ws.userId = userId;
    ws.roomKey = key;

    console.log(
      `[ws] Client connected — app=${appId} user=${userId} (room size: ${clients.get(key).size})`,
    );

    // 3. Pong handler for heartbeat
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // 4. Cleanup on close
    ws.on("close", () => {
      const room = clients.get(key);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          clients.delete(key);
        }
      }
    });

    // 5. Ignore incoming messages (this is a push-only channel)
    ws.on("message", () => {
      // No-op: clients don't send data
    });
  });

  console.log("[ws] WebSocket server attached on /ws and /api/ws");
  return wss;
}

/**
 * Broadcast an event to all connected clients for a given app + user.
 *
 * @param {string} appId
 * @param {string} userId
 * @param {string} event   — event name (e.g. "new_notification")
 * @param {object} data    — payload to send
 */
function broadcast(appId, userId, event, data) {
  const key = roomKey(appId, userId);
  const room = clients.get(key);
  if (!room || room.size === 0) {
    console.log(`[ws] broadcast(${event}) — no clients in room ${key}`);
    return;
  }

  const message = JSON.stringify({ event, data });
  let delivered = 0;

  for (const ws of room) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
      delivered++;
    }
  }

  console.log(
    `[ws] broadcast(${event}) — room=${key} size=${room.size} delivered=${delivered}`,
  );
}

/**
 * Get the number of active WebSocket connections (for health endpoint).
 */
function getConnectionCount() {
  let total = 0;
  for (const room of clients.values()) {
    total += room.size;
  }
  return total;
}

module.exports = { attachWebSocketServer, broadcast, getConnectionCount };
