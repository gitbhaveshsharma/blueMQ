const { Router } = require("express");
const { registry } = require("../../providers/registry");
const { queues } = require("../../queues");
const axios = require("axios");
const config = require("../../config");

const router = Router();

/**
 * GET /health
 *
 * Returns service status, registered providers, queue stats, and WAHA connectivity.
 * No auth required — useful for Railway health checks.
 */
router.get("/", async (_req, res) => {
  try {
    const queueStats = {};
    for (const [channel, queue] of queues) {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
      );
      queueStats[channel] = counts;
    }

    // ─── WAHA connectivity check ───
    let wahaStatus = { reachable: false, status: null, error: null };
    try {
      const headers = config.waha.apiKey
        ? { "X-Api-Key": config.waha.apiKey }
        : {};
      const { data } = await axios.get(
        `${config.waha.baseUrl}/api/server/status`,
        { headers, timeout: 5000 },
      );
      wahaStatus = {
        reachable: true,
        status: data.status ?? "ok",
        error: null,
      };
    } catch (err) {
      wahaStatus.error = err.code ?? err.message;
    }

    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: registry.toJSON(),
      queues: queueStats,
      waha: wahaStatus,
    });
  } catch (err) {
    console.error("[health] Error:", err);
    return res.status(500).json({ status: "error", error: err.message });
  }
});

module.exports = router;
