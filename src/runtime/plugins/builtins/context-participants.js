/**
 * Builtin plugin: context participants
 */

const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');

function normalizeText(value, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function toPositiveInt(value, fallback, max = 50) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(max, Math.floor(num));
}

function createParticipantsService() {
  return {
    resolveRecentParticipants(executionContext = {}, input = {}) {
      const contextService = executionContext.contextService || executionContext.conversationStore || null;
      const session = executionContext.session || {};
      if (!contextService || typeof contextService.buildContext !== 'function') {
        return {
          ok: false,
          error: 'context service is unavailable',
          participants: []
        };
      }

      const channelId = normalizeText(input.channelId, 120) || session.channelId || session.chatId || '';
      if (!channelId) {
        return {
          ok: false,
          error: 'missing channel context',
          participants: []
        };
      }

      const snapshot = contextService.buildContext({
        channelId,
        currentEventId: executionContext.currentEventId || null,
        userId: executionContext.userId || session.userId || '',
        username: executionContext.username || session.username || '',
        timestamp: Date.now()
      });
      const messages = Array.isArray(snapshot.channelRecentMessages) && snapshot.channelRecentMessages.length > 0
        ? snapshot.channelRecentMessages
        : (Array.isArray(snapshot.recentMessages) ? snapshot.recentMessages : []);
      const maxMessages = toPositiveInt(input.messageLimit, 12, 40);
      const maxParticipants = toPositiveInt(input.limit, 8, 20);
      const botUid = normalizeText(input.botUid || executionContext.sendOptions?.botProfile?.uid, 80);
      const map = new Map();

      for (const item of messages.slice(-maxMessages)) {
        if (!item || item.role === 'assistant') continue;
        const userId = normalizeText(item.userId, 80);
        const username = normalizeText(item.username, 80) || '未知用户';
        if (!userId) continue;
        if (botUid && userId === botUid) continue;

        const entry = map.get(userId) || {
          userId,
          username,
          messageCount: 0,
          snippets: [],
          lastTimestamp: 0
        };
        entry.messageCount += 1;
        entry.username = username;
        if (typeof item.timestamp === 'number' && item.timestamp > entry.lastTimestamp) {
          entry.lastTimestamp = item.timestamp;
        }
        const content = normalizeText(item.content || item.rawContent, 120);
        if (content && entry.snippets.length < 3) {
          entry.snippets.push(content);
        }
        map.set(userId, entry);
      }

      const participants = Array.from(map.values())
        .sort((left, right) => {
          if (left.messageCount !== right.messageCount) {
            return right.messageCount - left.messageCount;
          }
          return right.lastTimestamp - left.lastTimestamp;
        })
        .slice(0, maxParticipants);

      return {
        ok: true,
        participants,
        channelId
      };
    }
  };
}

module.exports = {
  name: 'builtin-context-participants',
  createParticipantsService,
  apply(host, context) {
    const service = createParticipantsService();
    host.registerService('context.participants', service);

    context.registerToolPackage({
      name: 'context-participants-package',
      version: '0.1.0',
      tools: [
        {
          name: 'context.participants.recent',
          description: '读取当前频道最近消息中的参与者列表，返回 uid、用户名、发言次数与片段。',
          aliases: [],
          inputSchema: {
            type: 'object',
            properties: {
              channelId: { type: 'string' },
              limit: { type: 'number' },
              messageLimit: { type: 'number' }
            }
          },
          outputSchema: {
            type: 'object'
          },
          permission: ['admin'],
          scopes: ['current-session'],
          readOnly: true,
          sideEffect: false,
          riskLevel: 'low',
          timeoutMs: 5000,
          origin: 'builtin',
          metadata: {
            directMatch: false,
            workflowVisible: true,
            helpVisible: false,
            adminOnly: true
          },
          async execute(executionContext = {}, input = {}) {
            const userId = executionContext.session?.user?.id || executionContext.session?.userId || executionContext.userId || '';
            if (!isAdminUser(context.config, userId)) {
              return createToolResult({
                ok: false,
                name: 'context.participants.recent',
                error: '权限不足：此功能仅限管理员使用'
              });
            }

            const result = service.resolveRecentParticipants(executionContext, {
              ...input,
              botUid: context.config?.bot?.uid || ''
            });
            if (!result.ok) {
              return createToolResult({
                ok: false,
                name: 'context.participants.recent',
                error: result.error || 'failed to resolve recent participants',
                data: result
              });
            }

            const lines = result.participants.map(item => `${item.username}(uid=${item.userId}) x${item.messageCount}`);
            const rendered = lines.length > 0
              ? `最近参与者：\n${lines.join('\n')}`
              : '最近未识别到可用参与者。';

            return createToolResult({
              ok: true,
              name: 'context.participants.recent',
              result: rendered,
              summary: rendered.slice(0, 120),
              data: {
                channelId: result.channelId,
                participants: result.participants
              }
            });
          }
        }
      ],
      skills: [
        {
          id: 'context.participant-resolution',
          name: '参与者解析',
          summary: '从当前频道最近消息中提取参与者 uid、用户名和活跃度。',
          description: '适用于“刚才那几个人”“最近参与争执的人”等上下文指代解析。',
          toolNames: ['context.participants.recent'],
          tags: ['context', 'participants', 'moderation'],
          adminOnly: true,
          examples: [
            '读取最近参与争执的用户列表',
            '在发送私聊警告前先提取最近涉及的 uid'
          ],
          metadata: {
            priority: 95,
            pluginName: 'builtin-context-participants'
          }
        }
      ],
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: ['context.participants.recent'],
            instruction: '当管理员以“刚才那几个人”“最近涉及的人”等模糊指代目标用户时，应先用 context.participants.recent 解析近期参与者，再决定后续动作。'
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: ['context.participants.recent'],
            instruction: '管理员私聊中若提到“刚才那几个人”等模糊对象，应先解析近期参与者。'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-context-participants',
        adminOnly: true,
        description: '基于近期上下文的参与者提取能力'
      }
    });
  }
};
