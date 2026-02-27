const { Router } = require("express");
const { registry } = require("../../providers/registry");
const { queues } = require("../../queues");

const router = Router();

/**
 * GET /health
 *
 * Returns service status, registered providers, and queue stats.
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

    return res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: registry.toJSON(),
      queues: queueStats,
    });
  } catch (err) {
    console.error("[health] Error:", err);
    return res.status(500).json({ status: "error", error: err.message });
  }
});

module.exports = router;
