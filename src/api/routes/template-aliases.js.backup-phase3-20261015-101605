const { Router } = require("express");
const {
  validateAliasInput,
  listTemplateAliases,
  saveTemplateAlias,
  deleteTemplateAlias,
  templateAliasTargetExists,
} = require("../../utils/template-alias");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await listTemplateAliases({
      appId: req.appId,
      channel: req.query.channel,
      entityId: req.query.entity_id,
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[template-aliases] GET / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function writeAlias(req, res) {
  const input = validateAliasInput(
    req.body?.channel,
    req.body?.notification_type,
    req.body?.resolves_to,
  );
  if (input.error) {
    return res.status(400).json({ error: input.error });
  }

  const entityId = String(req.body?.entity_id || "").trim();
  if (input.channel === "whatsapp" && !entityId) {
    return res
      .status(400)
      .json({ error: "entity_id is required for WhatsApp aliases" });
  }

  const targetExists = await templateAliasTargetExists({
    appId: req.appId,
    channel: input.channel,
    entityId,
    name: input.resolves_to,
  });
  if (!targetExists) {
    return res.status(400).json({
      error: `No ${input.channel} template named "${input.resolves_to}" exists`,
    });
  }

  const row = await saveTemplateAlias({
    id: req.params.id || null,
    appId: req.appId,
    channel: input.channel,
    entityId,
    notificationType: input.notification_type,
    resolvesTo: input.resolves_to,
  });
  if (!row) {
    return res.status(404).json({ error: "Template alias not found" });
  }
  return res.status(req.params.id ? 200 : 201).json({
    success: true,
    data: row,
  });
}

router.post("/", async (req, res) => {
  try {
    return await writeAlias(req, res);
  } catch (err) {
    console.error("[template-aliases] POST / error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    return await writeAlias(req, res);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "An alias already exists for that channel and notification type",
      });
    }
    console.error("[template-aliases] PUT /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteTemplateAlias({
      id: req.params.id,
      appId: req.appId,
    });
    if (!deleted) {
      return res.status(404).json({ error: "Template alias not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[template-aliases] DELETE /:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
