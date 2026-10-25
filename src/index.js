require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const {
  installConsoleInterceptors,
  requestContextMiddleware,
  requestLoggingMiddleware,
} = require("./logger");

installConsoleInterceptors();

const config = require("./config");
const { migrate } = require("./db/migrate");
const { createQueues } = require("./queues");
const { startWorkers } = require("./workers");
const { bootstrapProviders } = require("./providers/bootstrap");
const { authMiddleware } = require("./api/middlewares/auth");
const { getProcessModeConfig } = require("./runtime/process-mode");
const { getDb, warmPool } = require("./db");

// ─── Security Middleware (Phase 1 & 2) ───
const { requestValidationMiddleware } = require("./api/middlewares/request-validation");
const { securityHeadersMiddleware, customSecurityHeaders } = require("./api/middlewares/security-headers");
const { globalRateLimiter, endpointRateLimiter } = require("./api/middlewares/rate-limiting");
const { ipAccessControlMiddleware } = require("./api/middlewares/ip-access-control");
const { bruteForceProtectionMiddleware } = require("./api/middlewares/brute-force-protection");
const { hardenedCorsMiddleware } = require("./api/middlewares/cors-hardened");
const securityConfig = require("./config/security.config");

// ─── Routes ───
const healthRoutes = require("./api/routes/health");
const appsRoutes = require("./api/routes/apps");
const notifyRoutes = require("./api/routes/notify");
const notificationsRoutes = require("./api/routes/notifications");
const templatesRoutes = require("./api/routes/templates");
const whatsappSessionsRoutes = require("./api/routes/whatsapp-sessions");
const authRoutes = require("./api/routes/auth");
const settingsRoutes = require("./api/routes/settings");
const schedulesRoutes = require("./api/routes/schedules");
const audiencesRoutes = require("./api/routes/audiences");
const whatsappTemplatesRoutes = require("./api/routes/whatsapp-templates");
const templateAliasesRoutes = require("./api/routes/template-aliases");
const quotaRoutes = require("./api/routes/quota");
const webhookConfigRoutes = require("./api/routes/webhook-config");
const entitiesRoutes = require("./api/routes/entities");
const { attachWebSocketServer } = require("./ws");

function createExpressApp() {
  const app = express();

  // Trust proxy headers (Nginx forwards real client IP via X-Forwarded-For, X-Real-IP)
  // This is required for correct IP detection in security middleware
  app.set('trust proxy', true);

  // ─── Security Layer (Phase 1 & 2) ───
  // Order matters: fastest rejection first

  app.use(requestContextMiddleware);

  // PHASE 2: IP access control (first line of defense)
  app.use(ipAccessControlMiddleware);

  // PHASE 1: Request validation (blocks malicious patterns)
  app.use(requestValidationMiddleware);

  // PHASE 1: Security headers (helmet + custom)
  app.use(securityHeadersMiddleware());
  app.use(customSecurityHeaders);

  // PHASE 2: CORS (hardened or permissive based on config)
  app.use(hardenedCorsMiddleware());

  // PHASE 1: Global rate limiting (per IP)
  app.use(globalRateLimiter());

  // Body parsing
  app.use(express.json({ limit: "1mb" }));

  // Request logging
  app.use(requestLoggingMiddleware);

  return app;
}

function registerRoutes(app) {
  // ─── Public routes (no auth) ───
  app.use("/health", healthRoutes);
  app.use("/apps", appsRoutes);

  // PHASE 2: Auth routes with brute force protection + rate limiting
  app.use(
    "/auth",
    bruteForceProtectionMiddleware,
    endpointRateLimiter('auth', securityConfig.rateLimiting.auth),
    authRoutes
  );

  // ─── Protected routes (require x-api-key) ───

  // Notify endpoint with endpoint-specific rate limiting
  app.use(
    "/notify",
    authMiddleware,
    endpointRateLimiter('notify', {
      ...securityConfig.rateLimiting.notify,
      trackBy: 'apiKey'
    }),
    notifyRoutes
  );

  app.use("/notifications", bruteForceProtectionMiddleware, authMiddleware, notificationsRoutes);
  app.use("/templates", bruteForceProtectionMiddleware, authMiddleware, templatesRoutes);
  app.use("/whatsapp", bruteForceProtectionMiddleware, authMiddleware, whatsappSessionsRoutes);
  app.use("/settings", settingsRoutes);

  // Schedules with trigger endpoint rate limiting
  app.use("/schedules", bruteForceProtectionMiddleware, authMiddleware, schedulesRoutes);

  app.use("/audiences", bruteForceProtectionMiddleware, authMiddleware, audiencesRoutes);
  app.use("/whatsapp-templates", bruteForceProtectionMiddleware, authMiddleware, whatsappTemplatesRoutes);
  app.use("/template-aliases", bruteForceProtectionMiddleware, authMiddleware, templateAliasesRoutes);
  app.use("/quota", bruteForceProtectionMiddleware, authMiddleware, quotaRoutes);
  app.use("/webhooks", bruteForceProtectionMiddleware, authMiddleware, webhookConfigRoutes);
  app.use("/entities", bruteForceProtectionMiddleware, authMiddleware, entitiesRoutes);
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

  // Use http.createServer so WebSocket can share the same port
  const http = require("http");
  const server = http.createServer(app);

  // Attach WebSocket server to the HTTP server
  attachWebSocketServer(server);

  server.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log("═══════════════════════════════════════════");
    console.log("[security] Security middleware status:");
    console.log(`  Phase 1 (Core):`);
    console.log(`    - Request validation: ${securityConfig.enabled.requestValidation}`);
    console.log(`    - Rate limiting: ${securityConfig.enabled.rateLimiting}`);
    console.log(`    - Security headers: ${securityConfig.enabled.securityHeaders}`);
    console.log(`  Phase 2 (Advanced):`);
    console.log(`    - IP blacklist: ${securityConfig.enabled.ipBlacklist}`);
    console.log(`    - Brute force protection: ${securityConfig.enabled.bruteForceProtection}`);
    console.log(`    - Threat scoring: ${securityConfig.enabled.threatScoring}`);
    console.log(`    - CORS hardening: ${securityConfig.enabled.corsHardening}`);
    console.log("═══════════════════════════════════════════");
  });
}

async function bootstrapByMode(runtime) {
  // if (runtime.runMigrations) {
  //   await migrate();
  // }

  bootstrapProviders();

  if (runtime.runApi || runtime.runWorkers) {
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

  // ── Part C: Pre-warm the PG pool ──────────────────────────────────────────
  // Initialise getDb() here so the Pool + 2 min connections are established
  // before the first HTTP request arrives. Neon cold-starts cost ~2s; this
  // moves that cost to startup where it is invisible to callers.
  try {
    getDb(); // instantiates the Pool (min:2 sockets begin connecting)
    await warmPool(); // blocks until the 2 sockets are auth'd + idle in pool
  } catch (warmErr) {
    console.warn("[server] Pool warm-up failed (non-fatal):", warmErr.message);
  }

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
