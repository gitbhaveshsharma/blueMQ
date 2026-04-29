const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const config = require("./config");
const { migrate } = require("./db/migrate");
const { createQueues } = require("./queues");
const { startWorkers } = require("./workers");
const { bootstrapProviders } = require("./providers/bootstrap");
const { authMiddleware } = require("./api/middlewares/auth");
const { getProcessModeConfig } = require("./runtime/process-mode");

// ─── Routes ───
const healthRoutes = require("./api/routes/health");
const appsRoutes = require("./api/routes/apps");
const notifyRoutes = require("./api/routes/notify");
const notificationsRoutes = require("./api/routes/notifications");
const templatesRoutes = require("./api/routes/templates");
const whatsappSessionsRoutes = require("./api/routes/whatsapp-sessions");
const authRoutes = require("./api/routes/auth");
const settingsRoutes = require("./api/routes/settings");

function createExpressApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("short"));

  return app;
}

function registerRoutes(app) {
  // ─── Public routes (no auth) ───
  app.use("/health", healthRoutes);
  app.use("/apps", appsRoutes);
  app.use("/auth", authRoutes);

  // ─── Protected routes (require x-api-key) ───
  app.use("/notify", authMiddleware, notifyRoutes);
  app.use("/notifications", authMiddleware, notificationsRoutes);
  app.use("/templates", authMiddleware, templatesRoutes);
  app.use("/whatsapp", authMiddleware, whatsappSessionsRoutes);
  app.use("/settings", settingsRoutes);
}

function registerHttpHandlers(app) {
  // ─── 404 ───
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // ─── Global error handler ───
  app.use((err, _req, res, _next) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });
}

function startApiServer() {
  const app = createExpressApp();
  registerRoutes(app);
  registerHttpHandlers(app);

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log("═══════════════════════════════════════════");
  });
}

async function bootstrapByMode(runtime) {
  if (runtime.runMigrations) {
    await migrate();
  }

  bootstrapProviders();

  if (runtime.runApi) {
    createQueues();
  }

  if (runtime.runWorkers) {
    startWorkers(runtime.workerChannels);
  }
}

async function closeRedisAndExit(signal) {
  console.log(`[server] ${signal} received, shutting down...`);
  try {
    const { closeRedis } = require("./queues/connection");
    await closeRedis();
  } finally {
    process.exit(0);
  }
}

function registerShutdownHandlers() {
  process.on("SIGTERM", () => closeRedisAndExit("SIGTERM"));
  process.on("SIGINT", () => closeRedisAndExit("SIGINT"));
}

function registerProcessErrorHandlers() {
  process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[server] Uncaught exception:", err);
    process.exit(1);
  });
}

async function main() {
  const runtime = getProcessModeConfig();

  console.log("═══════════════════════════════════════════");
  console.log("  BlueMQ — Notification Service");
  console.log("═══════════════════════════════════════════");
  console.log(
    `[runtime] mode=${runtime.mode} workers=${runtime.workerChannels.join(",") || "none"}`,
  );

  await bootstrapByMode(runtime);

  if (runtime.runApi) {
    startApiServer();
  } else {
    console.log("[server] API disabled for worker-only process");
  }
}

registerShutdownHandlers();
registerProcessErrorHandlers();

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
