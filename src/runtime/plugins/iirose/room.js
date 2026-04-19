/**
 * Builtin plugin: iirose room tools
 */

const {
  createIiroseQueryTool,
  createIiroseActionTool,
  formatStructuredResult
} = require('../../../tools/factories/iirose-tool');
const internalService = require('../../../services/iirose/internal');

function resolveRequiredRoomId(input, actionLabel) {
  const rawText = pickFirstRoomSource(input);
  const roomId = extractRoomId(rawText);
  if (!roomId) {
    return `请提供需要${actionLabel}的房间ID。`;
  }
  return roomId;
}

function pickFirstRoomSource(input = {}) {
  const candidates = [
    input.roomId,
    input.targetRoom,
    input.channelId,
    input.query,
    input.raw
  ];

  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return '';
}

function extractRoomId(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const sharpMatch = text.match(/<sharp\b[^>]*\bid=["']?([^"'>\s]+)["']?[^>]*\/?>/i);
  if (sharpMatch?.[1]) {
    return sharpMatch[1].trim();
  }

  const plainIdMatch = text.match(/[0-9a-f]{8,32}/i);
  if (plainIdMatch?.[0]) {
    return plainIdMatch[0].trim();
  }

  return text;
}

module.exports = {
  name: 'iirose-room-tools',
  apply(host, context) {
    host.registerService('iirose.internal', internalService);

    context.registerToolPackage({
      name: 'iirose-room-tool-package',
      version: '0.2.0',
      tools: [
        createIiroseQueryTool({
          name: 'iirose.room.current',
          description: '查询当前 IIROSE 所在房间ID',
          aliases: ['当前房间', '房间信息', 'room'],
          permission: ['chat'],
          methodName: 'getRoomId',
          title: '当前房间',
          metadata: {
            directAliases: ['当前房间']
          }
        }),
        createIiroseQueryTool({
          name: 'iirose.room.list',
          description: '查询 IIROSE 房间列表原始数据',
          aliases: ['房间列表', 'rooms'],
          permission: ['chat'],
          methodName: 'getRoomListFile',
          title: '房间列表',
          formatResult: (value) => formatStructuredResult('房间列表', value),
          metadata: {
            directMatch: false
          }
        }),
        createIiroseActionTool({
          name: 'iirose.room.move',
          description: '切换机器人到指定 IIROSE 房间（单向操作）。适用于“切房”“换房”“转移到某房间”“移动到某房间”“去某房间”“把 bot 挪到某房间”等管理员意图；支持 <sharp id="房间ID"/> 或直接提供房间 ID。若需返回原房间，需要再次调用此工具切换回来。',
          aliases: ['切房', '换房', '切换房间', '切换到', '跳房', '转房', '转到房间', '转到这个房间去', '转移到', '移动到', '移步到', '去房间', '去这个房间', '挪到房间'],
          permission: ['admin'],
          methodName: 'moveRoom',
          resolveArgs: (input) => {
            const roomId = resolveRequiredRoomId(input, '切换到');
            if (typeof roomId === 'string' && roomId.startsWith('请提供')) {
              return roomId;
            }
            return { roomId };
          },
          successMessage: '房间切换指令已发送。',
          metadata: {
            directMatch: true,
            directAliases: ['切房', '转移到', '移动到', '移步到']
          }
        }),
        createIiroseActionTool({
          name: 'iirose.room.subscribe',
          description: '订阅指定 IIROSE 房间',
          aliases: ['订阅房间'],
          permission: ['chat'],
          methodName: 'subscribeRoom',
          resolveArgs: (input) => resolveRequiredRoomId(input, '订阅'),
          successMessage: '房间订阅指令已发送。',
          metadata: {
            directMatch: false
          }
        }),
        createIiroseActionTool({
          name: 'iirose.room.unsubscribe',
          description: '取消订阅指定 IIROSE 房间',
          aliases: ['取消订阅房间'],
          permission: ['chat'],
          methodName: 'unsubscribeRoom',
          resolveArgs: (input) => resolveRequiredRoomId(input, '取消订阅'),
          successMessage: '房间取消订阅指令已发送。',
          metadata: {
            directMatch: false
          }
        })
      ],
      skills: [
        {
          id: 'iirose.room-management',
          name: '房间管理',
          summary: '查询当前房间、切房、订阅房间等 IIROSE 房间操作。',
          toolNames: [
            'iirose.room.current',
            'iirose.room.list',
            'iirose.room.move',
            'iirose.room.subscribe',
            'iirose.room.unsubscribe'
          ],
          tags: ['iirose', 'room'],
          metadata: {
            priority: 65,
            pluginName: 'iirose-room-tools'
          }
        }
      ],
      metadata: {
        pluginName: 'iirose-room-tools'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            instruction: '当管理员要求转移、移动、移步、切换到某个房间时，优先考虑 iirose.room.move；用户消息中出现 <sharp id="房间ID"/> 或房间 ID 时，通常应作为 roomId 参数传给该工具，而不是把它当成普通闲聊。'
          }
        },
        {
          kind: 'message.private',
          template: {
            instruction: '管理员私聊中如果表达转移、移动、切换到某个房间的意图，优先考虑 iirose.room.move；出现 <sharp id="房间ID"/> 或直接房间 ID 时，应将其解析为 roomId。'
          }
        }
      ]
    });
  }
};
