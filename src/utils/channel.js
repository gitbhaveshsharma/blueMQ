const PUBLIC_CHANNELS = Object.freeze([
  "push",
  "email",
  "sms",
  "whatsapp",
  "in_app",
]);

const PUBLIC_CHANNEL_ALIASES = Object.freeze({
  inapp: "in_app",
});

const INTERNAL_CHANNELS = Object.freeze([
  "push",
  "email",
  "sms",
  "whatsapp",
  "inapp",
]);

const PUBLIC_TO_INTERNAL_CHANNEL = Object.freeze({
  in_app: "inapp",
});

const INTERNAL_TO_PUBLIC_CHANNEL = Object.freeze({
  inapp: "in_app",
});

function normalizeRawChannel(channel) {
  if (typeof channel !== "string") {
    return null;
  }

  const value = channel.trim().toLowerCase();
  return value || null;
}

function normalizePublicChannel(channel) {
  const value = normalizeRawChannel(channel);
  if (!value) {
    return null;
  }

  const canonical = PUBLIC_CHANNEL_ALIASES[value] || value;
  return PUBLIC_CHANNELS.includes(canonical) ? canonical : null;
}

function isValidPublicChannel(channel) {
  return Boolean(normalizePublicChannel(channel));
}

function normalizePublicChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const channel of channels) {
    const value = normalizePublicChannel(channel);
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function getAllowedPublicChannels() {
  return [...PUBLIC_CHANNELS];
}

function getTemplateChannelCandidates(channel) {
  const canonical = normalizePublicChannel(channel);
  if (!canonical) {
    return [];
  }

  if (canonical === "in_app") {
    return ["in_app", "inapp"];
  }

  return [canonical];
}

function toInternalChannel(channel) {
  const canonical = normalizePublicChannel(channel);
  if (!canonical) {
    return null;
  }

  return PUBLIC_TO_INTERNAL_CHANNEL[canonical] || canonical;
}

function toInternalChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  const mapped = [];
  const seen = new Set();

  for (const channel of channels) {
    const value = toInternalChannel(channel);
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    mapped.push(value);
  }

  return mapped;
}

function toPublicChannel(channel) {
  const value = normalizeRawChannel(channel);
  if (!value) {
    return null;
  }

  if (INTERNAL_TO_PUBLIC_CHANNEL[value]) {
    return INTERNAL_TO_PUBLIC_CHANNEL[value];
  }

  return normalizePublicChannel(value);
}

function normalizeWorkerChannel(channel) {
  const value = normalizeRawChannel(channel);
  if (!value) {
    return null;
  }

  if (INTERNAL_CHANNELS.includes(value)) {
    return value;
  }

  const mapped = toInternalChannel(value);
  return mapped && INTERNAL_CHANNELS.includes(mapped) ? mapped : null;
}

module.exports = {
  PUBLIC_CHANNELS,
  INTERNAL_CHANNELS,
  normalizePublicChannel,
  isValidPublicChannel,
  normalizePublicChannels,
  getAllowedPublicChannels,
  getTemplateChannelCandidates,
  toInternalChannel,
  toInternalChannels,
  toPublicChannel,
  normalizeWorkerChannel,
};
