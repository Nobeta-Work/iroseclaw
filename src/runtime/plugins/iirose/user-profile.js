/**
 * Builtin plugin: iirose user/profile query tools
 */

const { createIiroseQueryTool } = require('../../../tools/factories/iirose-tool');
const internalService = require('../../../services/iirose/internal');

function resolveRequiredQuery(input, label) {
  const query = typeof input.query === 'string'
    ? input.query.trim()
    : (typeof input.raw === 'string' ? input.raw.trim() : '');
  if (!query) {
    return `请提供${label}关键词。`;
  }
  return [query];
}

module.exports = {
  name: 'iirose-user-profile-tools',
  apply(host, context) {
    host.registerService('iirose.internal', internalService);

    context.registerToolPackage({
      name: 'iirose-user-profile-tool-package',
      version: '0.2.0',
      tools: [
        createIiroseQueryTool({
          name: 'iirose.user.by_name',
          description: '按用户名查询 IIROSE 用户基础信息',
          aliases: ['查用户', '找用户', 'user'],
          permission: ['chat'],
          methodName: 'getUserByName',
          title: '用户信息',
          resolveArgs: (input) => resolveRequiredQuery(input, '用户名'),
          metadata: {
            directAliases: ['查用户']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.user.profile.by_name',
          description: '按用户名查询 IIROSE 用户资料',
          aliases: ['查资料', '用户资料', '资料'],
          permission: ['chat'],
          methodName: 'getUserProfileByName',
          title: '用户资料',
          resolveArgs: (input) => resolveRequiredQuery(input, '用户名'),
          metadata: {
            directAliases: ['查资料']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.user.follow_list',
          description: '按 UID 查询 IIROSE 关注与粉丝列表',
          aliases: ['关注列表', '粉丝列表'],
          permission: ['chat'],
          methodName: 'getFollowList',
          title: '关注与粉丝列表',
          resolveArgs: (input) => resolveRequiredQuery(input, 'UID'),
          metadata: {
            directAliases: ['关注列表']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.user.profile.self',
          description: '查询当前机器人自身账号资料',
          aliases: ['我的资料', '我的信息', 'selfinfo'],
          permission: ['chat'],
          methodName: 'getSelfInfo',
          title: '自身账号资料',
          resolveArgs: () => [],
          metadata: {
            directAliases: ['我的资料']
          }
        })
      ],
      metadata: {
        pluginName: 'iirose-user-profile-tools'
      }
    });
  }
};
