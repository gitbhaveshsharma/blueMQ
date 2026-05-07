export const TEMPLATE_FORMATS = Object.freeze([
  { id: "text", label: "Plain text" },
  { id: "html", label: "HTML" },
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
    description: "Meta Cloud API text messages only.",
    supportsTitle: false,
    supportsCta: false,
    formats: ["text"],
    defaultFormat: "text",
    bodyPlaceholder: "Hi {{student_name}}, your fee is due.",
    bodyHelp:
      "Use plain text only. Approved template content is required outside the 24 hour window.",
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
