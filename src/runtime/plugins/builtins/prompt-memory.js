/**
 * Builtin plugin: prompt persona memory
 */

const { createPersonaMemoryService } = require('../../prompt-memory/service');

module.exports = {
  name: 'builtin-prompt-memory',
  apply(host, context) {
    const promptProfileService = host.getService('workflow.prompt-profile') || null;
    const promptProfileConfig = context.config?.workflow?.promptProfile || {};
    const memoryConfig = promptProfileConfig.memory && typeof promptProfileConfig.memory === 'object'
      ? promptProfileConfig.memory
      : {};

    const defaultProvider = host.getService('provider.default') || null;
    const service = createPersonaMemoryService({
      enabled: memoryConfig.enabled !== false,
      persist: memoryConfig.persist !== false,
      dataDir: memoryConfig.dataDir,
      maxEntries: memoryConfig.maxEntries,
      summaryThresholdRounds: memoryConfig.summaryThresholdRounds,
      summaryThresholdAgeMs: memoryConfig.summaryThresholdAgeMs,
      compressionPickCount: memoryConfig.compressionPickCount,
      compressionTargetCount: memoryConfig.compressionTargetCount,
      timeoutMs: memoryConfig.timeoutMs,
      promptProfileService,
      provider: memoryConfig.provider || defaultProvider || null,
      now: typeof memoryConfig.now === 'function' ? memoryConfig.now : null
    }, context.logger || host.logger || console);

    host.registerService('workflow.persona-memory', service);
  }
};
