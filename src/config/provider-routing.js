function parseBooleanEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallbackValue;

  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(
    `[config] Invalid boolean value for ${name}: "${raw}". Use true/false`,
  );
}

function getProviderFlags() {
  return {
    push: {
      onesignal: parseBooleanEnv("PROVIDER_PUSH_ONESIGNAL", true),
      firebase: parseBooleanEnv("PROVIDER_PUSH_FIREBASE", false),
    },
    email: {
      onesignal: parseBooleanEnv("PROVIDER_EMAIL_ONESIGNAL", false),
      resend: parseBooleanEnv("PROVIDER_EMAIL_RESEND", true),
      msg91: parseBooleanEnv("PROVIDER_EMAIL_MSG91", false),
    },
    sms: {
      onesignal: parseBooleanEnv("PROVIDER_SMS_ONESIGNAL", true),
      twilio: parseBooleanEnv("PROVIDER_SMS_TWILIO", false),
      msg91: parseBooleanEnv("PROVIDER_SMS_MSG91", false),
    },
    whatsapp: {
      meta: parseBooleanEnv("PROVIDER_WHATSAPP_META", true),
      msg91: parseBooleanEnv("PROVIDER_WHATSAPP_MSG91", false),
    },
    call: {
      msg91: parseBooleanEnv("PROVIDER_CALL_MSG91", true),
    },
  };
}

function resolveChannelProvider(channel, flags) {
  const enabled = Object.entries(flags)
    .filter(([, isEnabled]) => isEnabled)
    .map(([name]) => name);

  if (enabled.length !== 1) {
    throw new Error(
      `[config] Channel "${channel}" must have exactly one enabled provider. Enabled: ${enabled.join(", ") || "none"}`,
    );
  }

  return enabled[0];
}

function buildProviderRouting() {
  const flags = getProviderFlags();

  return {
    flags,
    primary: {
      push: resolveChannelProvider("push", flags.push),
      email: resolveChannelProvider("email", flags.email),
      sms: resolveChannelProvider("sms", flags.sms),
      whatsapp: resolveChannelProvider("whatsapp", flags.whatsapp),
      call: resolveChannelProvider("call", flags.call),
      inapp: "inapp",
    },
  };
}

module.exports = { buildProviderRouting };
