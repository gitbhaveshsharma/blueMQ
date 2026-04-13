/**
 * Bootstrap the provider registry — wire up channel → provider mappings.
 *
 * Provider selection for push/email/sms is config-driven:
 *   - src/config/provider-routing.js
 *   - env flags: PROVIDER_* (e.g. PROVIDER_PUSH_FIREBASE=true)
 *
 * To add a new provider in future:
 *   1. Create provider extending INotificationProvider
 *   2. Add a factory here
 *   3. Add channel flag in provider-routing config
 *
 * WhatsApp supports two providers:
 *   - WAHA (default): Self-hosted, uses QR code scanning
 *   - Meta: WhatsApp Cloud API, uses API key authentication
 *
 * The getWhatsAppProvider() helper returns the correct provider instance
 * based on the connection_type stored in the database.
 */

const { registry } = require("./registry");
const config = require("../config");
const { OneSignalProvider } = require("./onesignal.provider");
const { FirebaseProvider } = require("./firebase.provider");
const { ResendProvider } = require("./resend.provider");
const { WahaProvider } = require("./waha.provider");
const { MetaWhatsAppProvider } = require("./meta-whatsapp.provider");
const { InAppProvider } = require("./inapp.provider");

// Provider instances (created once at startup)
let wahaProvider = null;
let metaWhatsAppProvider = null;

function createProviderFactories() {
  const cache = {};

  return {
    onesignal: () => (cache.onesignal ||= new OneSignalProvider()),
    firebase: () => (cache.firebase ||= new FirebaseProvider()),
    resend: () => (cache.resend ||= new ResendProvider()),
    inapp: () => (cache.inapp ||= new InAppProvider()),
    waha: () => (cache.waha ||= new WahaProvider()),
    meta: () => (cache.meta ||= new MetaWhatsAppProvider()),
  };
}

function registerPrimaryChannel(channel, providerName, factories) {
  const factory = factories[providerName];
  if (!factory) {
    throw new Error(
      `[providers] Unknown provider "${providerName}" configured for channel "${channel}"`,
    );
  }
  registry.register(channel, factory());
}

function bootstrapProviders() {
  const factories = createProviderFactories();
  const primary = config.providers.primary;

  registerPrimaryChannel("push", primary.push, factories);
  registerPrimaryChannel("email", primary.email, factories);
  registerPrimaryChannel("sms", primary.sms, factories);
  registerPrimaryChannel("inapp", primary.inapp, factories);

  wahaProvider = factories.waha();
  metaWhatsAppProvider = factories.meta();
  registry.register("whatsapp", wahaProvider);

  console.log(
    "[providers] Routing config:",
    JSON.stringify(config.providers.primary),
  );

  console.log(
    "[providers] Registry initialised:",
    JSON.stringify(registry.toJSON()),
  );
}

/**
 * Get the appropriate WhatsApp provider based on connection type.
 *
 * @param {string} connectionType — 'waha' or 'meta'
 * @returns {import('./interface').INotificationProvider} — provider instance
 */
function getWhatsAppProvider(connectionType) {
  if (connectionType === "meta") {
    if (!metaWhatsAppProvider) {
      throw new Error(
        "MetaWhatsAppProvider not initialized — call bootstrapProviders() first",
      );
    }
    return metaWhatsAppProvider;
  }

  // Default to WAHA provider
  if (!wahaProvider) {
    throw new Error(
      "WahaProvider not initialized — call bootstrapProviders() first",
    );
  }
  return wahaProvider;
}

module.exports = { bootstrapProviders, getWhatsAppProvider };
