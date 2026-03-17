/**
 * Builtin plugin: OpenClaw agent bridge registration
 */

const { OpenClawAgentBridge } = require('../../../ai/providers/openclaw-agent-bridge');

module.exports = {
  name: 'builtin-openclaw-provider',
  apply(host, context) {
    const createBridge = ({ config, logger }) => new OpenClawAgentBridge({
      subagentLabel: config.openclaw?.subagentLabel || 'iirose-chat',
      timeout: config.openclaw?.timeout || 30000,
      local: config.openclaw?.local !== false,
      stateless: config.openclaw?.stateless !== false,
      logger: logger || console
    });

    // `openclaw` is kept as a compatibility alias for existing configs.
    context.registerProvider('openclaw', createBridge);
    context.registerProvider('openclaw-agent', createBridge);
  }
};
