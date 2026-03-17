/**
 * Builtin plugin: default trigger templates
 */

const { TRIGGER_TEMPLATES } = require('../../trigger/templates');

module.exports = {
  name: 'builtin-default-trigger-templates',
  apply(host, context) {
    context.registerToolPackage({
      name: 'builtin-default-trigger-templates-package',
      version: '0.2.0',
      triggerTemplates: Object.entries(TRIGGER_TEMPLATES).map(([kind, template]) => ({
        kind,
        template
      })),
      metadata: {
        pluginName: 'builtin-default-trigger-templates'
      }
    });
  }
};
