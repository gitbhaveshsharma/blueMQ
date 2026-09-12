export function parseWhatsAppEditorJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  const components = Array.isArray(parsed) ? parsed : parsed?.components;
  if (!Array.isArray(components)) {
    throw new Error("JSON must be a components array or { components: [] }");
  }
  return {
    envelope: Array.isArray(parsed) ? { components } : parsed,
    components,
  };
}
