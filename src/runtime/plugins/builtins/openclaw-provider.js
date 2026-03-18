/**
 * Builtin plugin: OpenClaw agent bridge registration
 */

const { OpenClawAgentBridge } = require('../../../ai/providers/openclaw-agent-bridge');

module.exports = {
  name: 'builtin-openclaw-provider',
  apply(host, context) {
    const createBridge = ({ config, logger }) => new OpenClawAgentBridge({
      agentLabel: config.openclaw?.agentLabel || config.openclaw?.subagentLabel || 'iirose-transport',
      timeout: config.openclaw?.timeout || 30000,
      local: config.openclaw?.local !== false,
      stateless: config.openclaw?.stateless !== false,
      thinking: config.openclaw?.thinking || '',
      isolatedStatePerRequest: config.openclaw?.isolatedStatePerRequest === true,
      cleanupStateDirAfterRequest: config.openclaw?.cleanupStateDirAfterRequest !== false,
      stateDirBase: config.openclaw?.stateDirBase,
      configPath: config.openclaw?.configPath,
      logger: logger || console
    });

    // `openclaw` is kept as a compatibility alias for existing configs.
    context.registerProvider('openclaw', createBridge);
    context.registerProvider('openclaw-agent', createBridge);
  }
};
