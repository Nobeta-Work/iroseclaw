/**
 * Builtin plugin: help tool
 */

const { createHelpOverviewTool } = require('../../../tools/builtins/help-overview');
const helpService = require('../../../services/help/overview');

module.exports = {
  name: 'builtin-help',
  apply(host, context) {
    host.registerService('help.overview', helpService);
    context.registerToolPackage({
      name: 'builtin-help-package',
      version: '0.2.0',
      tools: [
        createHelpOverviewTool({
          listSkills: () => host.skillManager?.list?.() || [],
          listTools: () => host.toolRegistry.list({ workflowVisibleOnly: true }),
          listPackages: () => host.listToolPackages(),
          runtimeConfig: context.config || {}
        })
      ],
      metadata: {
        pluginName: 'builtin-help'
      }
    });
  }
};
