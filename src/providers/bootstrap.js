/**
 * Bootstrap the provider registry — wire up channel → provider mappings.
 *
 * To swap a provider in future:
 *   1. Create new provider extending INotificationProvider
 *   2. Import it here
 *   3. Change one line: registry.register('push', new FCMProvider());
 *   4. Zero changes to workers, queues, or routes
 */

const { registry } = require("./registry");
const { OneSignalProvider } = require("./onesignal.provider");
const { MSG91Provider } = require("./msg91.provider");
const { InAppProvider } = require("./inapp.provider");

function bootstrapProviders() {
  const onesignal = new OneSignalProvider();
  const msg91 = new MSG91Provider();
  const inapp = new InAppProvider();

  // ─── Primary Providers ───
  registry.register("push", onesignal);
  registry.register("email", onesignal);
  registry.register("sms", onesignal);
  registry.register("whatsapp", msg91);
  registry.register("inapp", inapp);

  // ─── Fallbacks (uncomment when ready) ───
  // registry.registerFallback('push',  new FCMProvider());
  // registry.registerFallback('email', new SendGridProvider());
  // registry.registerFallback('sms',   msg91);

  console.log(
    "[providers] Registry initialised:",
    JSON.stringify(registry.toJSON()),
  );
}

module.exports = { bootstrapProviders };
