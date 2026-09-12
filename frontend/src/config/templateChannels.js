export const TEMPLATE_FORMATS = Object.freeze([
  { id: "text", label: "Plain text" },
  { id: "html", label: "HTML" },
  { id: "json", label: "JSON" },
]);

export const WHATSAPP_TEMPLATE_CATEGORIES = Object.freeze([
  { id: "UTILITY", label: "Utility" },
  { id: "MARKETING", label: "Marketing" },
  { id: "AUTHENTICATION", label: "Authentication" },
]);

export const WHATSAPP_TEMPLATE_LANGUAGES = Object.freeze([
  { id: "en", label: "English" },
  { id: "en_US", label: "English (US)" },
  { id: "en_GB", label: "English (UK)" },
  { id: "hi", label: "Hindi" },
  { id: "es", label: "Spanish" },
  { id: "pt_BR", label: "Portuguese (Brazil)" },
  { id: "ar", label: "Arabic" },
  { id: "fr", label: "French" },
  { id: "id", label: "Indonesian" },
]);

export const TEMPLATE_CHANNELS = Object.freeze([
  {
    id: "push",
    label: "Push",
    description: "Short title and body for device notifications.",
    supportsTitle: true,
    supportsCta: true,
    formats: ["text"],
    defaultFormat: "text",
    titlePlaceholder: "Fee reminder",
    bodyPlaceholder: "Your fee of {{amount}} is due.",
    ctaPlaceholder: "View details",
    bodyHelp: "Keep it concise for quick reading.",
    previewType: "card",
    badgeClass: "bg-blue-50 text-blue-700",
  },
  {
    id: "email",
    label: "Email",
    description: "Email subject and body. HTML is allowed when selected.",
    supportsTitle: true,
    titleLabel: "Subject",
    supportsCta: true,
    formats: ["text", "html"],
    defaultFormat: "text",
    titlePlaceholder: "Fee reminder",
    bodyPlaceholder: "Hi {{student_name}}, your fee of {{amount}} is due.",
    ctaPlaceholder: "View details",
    bodyHelp:
      "Use plain text or HTML. HTML is rendered as provided (inline styles recommended).",
    previewType: "email",
    badgeClass: "bg-violet-50 text-violet-700",
  },
  {
    id: "sms",
    label: "SMS",
    description: "Plain text message. No title or buttons.",
    supportsTitle: false,
    supportsCta: false,
    formats: ["text"],
    defaultFormat: "text",
    bodyPlaceholder: "Your fee of {{amount}} is due.",
    bodyHelp: "Keep under 160 characters when possible.",
    previewType: "chat",
    previewTone: "sms",
    badgeClass: "bg-amber-50 text-amber-700",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description:
      "Meta WhatsApp templates. Name, language, and category are submitted to Meta. Sync to cache names for /notify.",
    supportsTitle: false,
    supportsCta: false,
    formats: ["text", "json"],
    defaultFormat: "text",
    bodyPlaceholder: "Hi {{1}}, your fee is due.",
    bodyHelp:
      "Plain text becomes the BODY component. JSON mode uses Meta components. Name must match [a-z0-9_].",
    previewType: "chat",
    previewTone: "whatsapp",
    badgeClass: "bg-green-50 text-green-700",
  },
  {
    id: "in_app",
    label: "In-app",
    description: "Shown inside the product UI.",
    supportsTitle: true,
    supportsCta: true,
    formats: ["text"],
    defaultFormat: "text",
    titlePlaceholder: "Fee reminder",
    bodyPlaceholder: "Your fee of {{amount}} is due.",
    ctaPlaceholder: "View details",
    bodyHelp: "Keep it short and clear.",
    previewType: "card",
    badgeClass: "bg-rose-50 text-rose-700",
  },
]);

export const TEMPLATE_CHANNEL_MAP = Object.freeze(
  TEMPLATE_CHANNELS.reduce((acc, channel) => {
    acc[channel.id] = channel;
    return acc;
  }, {}),
);

export function getTemplateChannelConfig(channel) {
  return TEMPLATE_CHANNEL_MAP[channel] || TEMPLATE_CHANNELS[0];
}
