const { NotSupportedError } = require("./interface");

/**
 * Provider Registry
 * -----------------
 * Maps each channel to its primary (and optional fallback) provider.
 *
 * To swap a provider:
 *   1. Create a new provider that extends INotificationProvider
 *   2. Call registry.register('push', newProvider)       — replaces primary
 *   3. Call registry.registerFallback('push', oldProvider) — optional fallback
 *
 * Zero changes to workers, queues, or routes required.
 */

class ProviderRegistry {
  constructor() {
    /** @type {Map<string, import('./interface').INotificationProvider>} */
    this._primary = new Map();

    /** @type {Map<string, import('./interface').INotificationProvider>} */
    this._fallback = new Map();
  }

  /**
   * Register the primary provider for a channel.
   * @param {'push'|'email'|'sms'|'whatsapp'|'inapp'} channel
   * @param {import('./interface').INotificationProvider} provider
   */
  register(channel, provider) {
    this._primary.set(channel, provider);
  }

  /**
   * Register a fallback provider for a channel.
   */
  registerFallback(channel, provider) {
    this._fallback.set(channel, provider);
  }

  /**
   * Get the primary provider for a channel.
   * @param {string} channel
   * @returns {import('./interface').INotificationProvider}
   */
  getProvider(channel) {
    const provider = this._primary.get(channel);
    if (!provider) {
      throw new Error(`No provider registered for channel: ${channel}`);
    }
    return provider;
  }

  /**
   * Get the fallback provider (or null).
   */
  getFallback(channel) {
    return this._fallback.get(channel) || null;
  }

  /**
   * Send a notification through the correct provider method for the channel.
   * Falls back to the fallback provider if the primary throws NotSupportedError.
   *
   * @param {string} channel
   * @param {object} payload
   * @returns {Promise<{success:boolean, provider:string, providerMessageId?:string, error?:string}>}
   */
  async send(channel, payload) {
    const methodMap = {
      push: "sendPush",
      email: "sendEmail",
      sms: "sendSMS",
      whatsapp: "sendWhatsApp",
      inapp: "sendInApp",
    };

    const method = methodMap[channel];
    if (!method) throw new Error(`Unknown channel: ${channel}`);

    const primary = this.getProvider(channel);

    try {
      const result = await primary[method](payload);
      return { ...result, provider: primary.name };
    } catch (err) {
      // If the primary doesn't support this channel, try fallback
      if (err instanceof NotSupportedError) {
        const fallback = this.getFallback(channel);
        if (fallback) {
          const result = await fallback[method](payload);
          return { ...result, provider: fallback.name };
        }
      }
      throw err; // re-throw for BullMQ retry
    }
  }

  /** Summarise what's registered — useful for /health */
  toJSON() {
    const out = {};
    for (const [ch, provider] of this._primary) {
      out[ch] = {
        primary: provider.name,
        fallback: this._fallback.get(ch)?.name || null,
      };
    }
    return out;
  }
}

// Singleton
const registry = new ProviderRegistry();

module.exports = { registry, ProviderRegistry };
