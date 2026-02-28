const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const config = require("./config");
const { migrate } = require("./db/migrate");
const { createQueues } = require("./queues");
const { startAllWorkers } = require("./workers");
const { bootstrapProviders } = require("./providers/bootstrap");
const { authMiddleware } = require("./api/middlewares/auth");

// ─── Routes ───
const healthRoutes = require("./api/routes/health");
const appsRoutes = require("./api/routes/apps");
const notifyRoutes = require("./api/routes/notify");
const notificationsRoutes = require("./api/routes/notifications");
const templatesRoutes = require("./api/routes/templates");
const whatsappSessionsRoutes = require("./api/routes/whatsapp-sessions");

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  BlueMQ — Notification Service");
  console.log("═══════════════════════════════════════════");

  // ─── 1. Run DB migration ───
  await migrate();

  // ─── 2. Bootstrap providers ───
  bootstrapProviders();

  // ─── 3. Create BullMQ queues ───
  createQueues();

  // ─── 4. Start workers ───
  startAllWorkers();

  // ─── 5. Create Express app ───
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("short"));

  // ─── Public routes (no auth) ───
  app.use("/health", healthRoutes);
  app.use("/apps", appsRoutes);

  // ─── Protected routes (require x-api-key) ───
  app.use("/notify", authMiddleware, notifyRoutes);
  app.use("/notifications", authMiddleware, notificationsRoutes);
  app.use("/templates", authMiddleware, templatesRoutes);
  app.use("/whatsapp", authMiddleware, whatsappSessionsRoutes);

  // ─── 404 ───
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // ─── Global error handler ───
  app.use((err, _req, res, _next) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  // ─── 6. Start listening ───
  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log("═══════════════════════════════════════════");
  });
}

// ─── Graceful shutdown ───
process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received, shutting down...");
  const { closeRedis } = require("./queues/connection");
  await closeRedis();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[server] SIGINT received, shutting down...");
  const { closeRedis } = require("./queues/connection");
  await closeRedis();
  process.exit(0);
});

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
