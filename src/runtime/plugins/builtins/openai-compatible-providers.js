/**
 * Builtin plugin: register named OpenAI-compatible providers from runtime config
 */

const { OpenAICompatibleProvider } = require('../../../ai/providers/openai-compatible-provider');

function normalizeProviderType(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || 'openai-compatible';
}

module.exports = {
  name: 'builtin-openai-compatible-providers',
  apply(host, context) {
    const namedProviders = context.config?.providers?.named;
    if (!namedProviders || typeof namedProviders !== 'object' || Array.isArray(namedProviders)) {
      return;
    }

    for (const [providerNameRaw, providerConfigRaw] of Object.entries(namedProviders)) {
      const providerName = String(providerNameRaw || '').trim().toLowerCase();
      const providerConfig = providerConfigRaw && typeof providerConfigRaw === 'object' && !Array.isArray(providerConfigRaw)
        ? providerConfigRaw
        : null;
      if (!providerName || !providerConfig || providerConfig.enabled === false) {
        continue;
      }

      const type = normalizeProviderType(providerConfig.type);
      if (type !== 'openai-compatible' && type !== 'openai') {
        continue;
      }

      context.registerProvider(providerName, ({ logger }) => new OpenAICompatibleProvider({
        provider: providerName,
        label: providerName,
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        model: providerConfig.model,
        endpointPath: providerConfig.endpointPath,
        headers: providerConfig.headers,
        extraBody: providerConfig.extraBody,
        timeout: providerConfig.timeout,
        maxTokens: providerConfig.maxTokens,
        logger: logger || console
      }));
    }
  }
};
