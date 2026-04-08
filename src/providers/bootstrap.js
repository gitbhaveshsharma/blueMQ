/**
 * Bootstrap the provider registry — wire up channel → provider mappings.
 *
 * To swap a provider in future:
 *   1. Create new provider extending INotificationProvider
 *   2. Import it here
 *   3. Change one line: registry.register('push', new FCMProvider());
 *   4. Zero changes to workers, queues, or routes
 *
 * WhatsApp supports two providers:
 *   - WAHA (default): Self-hosted, uses QR code scanning
 *   - Meta: WhatsApp Cloud API, uses API key authentication
 *
 * The getWhatsAppProvider() helper returns the correct provider instance
 * based on the connection_type stored in the database.
 */

const { registry } = require("./registry");
const { OneSignalProvider } = require("./onesignal.provider");
const { WahaProvider } = require("./waha.provider");
const { MetaWhatsAppProvider } = require("./meta-whatsapp.provider");
const { InAppProvider } = require("./inapp.provider");

// Provider instances (created once at startup)
let wahaProvider = null;
let metaWhatsAppProvider = null;

function bootstrapProviders() {
  const onesignal = new OneSignalProvider();
  wahaProvider = new WahaProvider();
  metaWhatsAppProvider = new MetaWhatsAppProvider();
  const inapp = new InAppProvider();

  // ─── Primary Providers ───
  registry.register("push", onesignal);
  registry.register("email", onesignal);
  registry.register("sms", onesignal);
  registry.register("whatsapp", wahaProvider); // Default WhatsApp provider is WAHA
  registry.register("inapp", inapp);

  // ─── Fallbacks (uncomment when ready) ───
  // registry.registerFallback('push',  new FCMProvider());
  // registry.registerFallback('email', new SendGridProvider());
  // registry.registerFallback('sms',   new MSG91Provider());

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
