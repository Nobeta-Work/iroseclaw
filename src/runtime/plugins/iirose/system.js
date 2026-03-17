/**
 * Builtin plugin: iirose system query tools
 */

const { createIiroseQueryTool } = require('../../../tools/factories/iirose-tool');
const internalService = require('../../../services/iirose/internal');

module.exports = {
  name: 'iirose-system-tools',
  apply(host, context) {
    host.registerService('iirose.internal', internalService);

    context.registerToolPackage({
      name: 'iirose-system-tool-package',
      version: '0.2.0',
      tools: [
        createIiroseQueryTool({
          name: 'iirose.system.forum.get',
          description: '查询 IIROSE 论坛信息',
          aliases: ['论坛', 'forum'],
          permission: ['chat'],
          methodName: 'getForum',
          title: '论坛信息',
          metadata: {
            directAliases: ['论坛']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.system.tasks.get',
          description: '查询 IIROSE 任务信息',
          aliases: ['任务', 'tasks'],
          permission: ['chat'],
          methodName: 'getTasks',
          title: '任务信息',
          metadata: {
            directAliases: ['任务']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.system.leaderboard.get',
          description: '查询 IIROSE 排行榜信息',
          aliases: ['排行榜', '榜单', 'leaderboard'],
          permission: ['chat'],
          methodName: 'getLeaderboard',
          title: '排行榜信息',
          metadata: {
            directAliases: ['排行榜']
          }
        })
      ],
      metadata: {
        pluginName: 'iirose-system-tools'
      }
    });
  }
};
