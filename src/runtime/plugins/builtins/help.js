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
          runtimeConfig: context.config || {},
          getActiveModeService: () => host.getService('active-mode')
        })
      ],
      skills: [
        {
          id: 'assistant.help-overview',
          name: '帮助概览',
          summary: '展示当前机器人可见功能与快捷入口。',
          toolNames: ['help.show'],
          tags: ['assistant', 'help'],
          examples: ['查看当前有哪些功能', '问机器人能做什么'],
          metadata: {
            priority: 100,
            pluginName: 'builtin-help'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-help'
      }
    });
  }
};
