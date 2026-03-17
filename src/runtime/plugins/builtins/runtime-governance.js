/**
 * Builtin plugin: runtime governance
 */

const { createRuntimeConfigPolicyRule } = require('../../policy/rules/runtime-config');

module.exports = {
  name: 'builtin-runtime-governance',
  apply(host, context) {
    context.registerToolPackage({
      name: 'builtin-runtime-governance-package',
      version: '0.2.0',
      policies: [
        createRuntimeConfigPolicyRule(context.config)
      ],
      metadata: {
        pluginName: 'builtin-runtime-governance'
      }
    });
  }
};
