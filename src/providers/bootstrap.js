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
 * WhatsApp is Meta Cloud API only.
 *
 * The getWhatsAppProvider() helper returns the Meta provider instance.
 */

const { registry } = require("./registry");
const config = require("../config");
const { OneSignalProvider } = require("./onesignal.provider");
const { FirebaseProvider } = require("./firebase.provider");
const { ResendProvider } = require("./resend.provider");
const { MetaWhatsAppProvider } = require("./meta-whatsapp.provider");
const { InAppProvider } = require("./inapp.provider");

// Provider instances (created once at startup)
let metaWhatsAppProvider = null;

function createProviderFactories() {
  const cache = {};

  return {
    onesignal: () => (cache.onesignal ||= new OneSignalProvider()),
    firebase: () => (cache.firebase ||= new FirebaseProvider()),
    resend: () => (cache.resend ||= new ResendProvider()),
    inapp: () => (cache.inapp ||= new InAppProvider()),
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
  registerPrimaryChannel("whatsapp", primary.whatsapp, factories);
  registerPrimaryChannel("inapp", primary.inapp, factories);
  metaWhatsAppProvider = factories.meta();

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
 * Get the WhatsApp provider instance.
 *
 * @returns {import('./interface').INotificationProvider} — provider instance
 */
function getWhatsAppProvider() {
  if (!metaWhatsAppProvider) {
    throw new Error(
      "MetaWhatsAppProvider not initialized — call bootstrapProviders() first",
    );
  }
  return metaWhatsAppProvider;
}

module.exports = { bootstrapProviders, getWhatsAppProvider };
