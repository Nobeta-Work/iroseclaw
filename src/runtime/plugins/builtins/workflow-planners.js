/**
 * Builtin plugin: workflow planner registrations
 */

const { LlmWorkflowPlanner } = require('../../workflow/planners/llm-workflow-planner');

module.exports = {
  name: 'builtin-workflow-planners',
  apply(host, context) {
    context.registerPlanner('llm-default', ({ config, logger, provider, host: runtimeHost }) => new LlmWorkflowPlanner({
      provider,
      logger: logger || console,
      config: {
        useNativeSessionContext: config.openclaw?.useNativeSessionContext === true,
        meme: config.meme || {},
        timeoutMs: config.openclaw?.timeout || 30000,
        maxProviderRetries: config.workflow?.maxProviderRetries,
        promptProfile: config.workflow?.promptProfile || {},
        promptProfileService: runtimeHost?.getService?.('workflow.prompt-profile') || null
      }
    }));

    context.registerPlanner('llm', ({ config, logger, provider, host: runtimeHost }) => new LlmWorkflowPlanner({
      provider,
      logger: logger || console,
      config: {
        useNativeSessionContext: config.openclaw?.useNativeSessionContext === true,
        meme: config.meme || {},
        timeoutMs: config.openclaw?.timeout || 30000,
        maxProviderRetries: config.workflow?.maxProviderRetries,
        promptProfile: config.workflow?.promptProfile || {},
        promptProfileService: runtimeHost?.getService?.('workflow.prompt-profile') || null
      },
      label: 'llm'
    }));
  }
};
