/**
 * Builtin plugin: communication private messaging
 */

const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');

const DEFAULT_CONFIG = {
  batchLimit: 5,
  maxMessageLength: 280
};

function normalizeText(value, max = 280) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeUid(value) {
  return normalizeText(value, 80);
}

function resolveBot(executionContext = {}, pluginContext = {}) {
  return executionContext?.session?.bot
    || pluginContext?.ctx?.bots?.[0]
    || null;
}

function wrapPrivateChannelId(userId = '') {
  const uid = normalizeUid(userId);
  return uid ? `private:${uid}` : '';
}

function createPrivateMessagingService(config = {}, pluginContext = {}) {
  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...(config && typeof config === 'object' ? config : {})
  };

  return {
    getBatchLimit() {
      const value = Number(finalConfig.batchLimit);
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CONFIG.batchLimit;
    },
    async sendPrivate(executionContext = {}, input = {}) {
      const userId = normalizeUid(input.userId);
      const text = normalizeText(input.text, finalConfig.maxMessageLength);
      if (!userId) {
        return { ok: false, error: '缺少目标 userId。' };
      }
      if (!text) {
        return { ok: false, error: '私聊内容不能为空。' };
      }

      const bot = resolveBot(executionContext, pluginContext);
      if (!bot || typeof bot.sendMessage !== 'function') {
        return { ok: false, error: 'private messaging bot sender is unavailable' };
      }

      const channelId = wrapPrivateChannelId(userId);
      if (!channelId) {
        return { ok: false, error: '无法解析目标私聊频道。' };
      }

      try {
        const sendResult = await bot.sendMessage(channelId, text);
        return {
          ok: true,
          userId,
          channelId,
          text,
          sendResult
        };
      } catch (error) {
        return {
          ok: false,
          userId,
          channelId,
          text,
          error: error.message || 'private messaging failed'
        };
      }
    },
    async sendPrivateBatch(executionContext = {}, input = {}) {
      const userIds = [...new Set(
        (Array.isArray(input.userIds) ? input.userIds : [])
          .map(normalizeUid)
          .filter(Boolean)
      )];
      const text = normalizeText(input.text, finalConfig.maxMessageLength);

      if (userIds.length === 0) {
        return { ok: false, error: '缺少目标 userIds。', items: [] };
      }
      if (userIds.length > this.getBatchLimit()) {
        return {
          ok: false,
          error: `单次最多只允许向 ${this.getBatchLimit()} 个用户发送私聊。`,
          items: []
        };
      }
      if (!text) {
        return { ok: false, error: '私聊内容不能为空。', items: [] };
      }

      const items = [];
      for (const userId of userIds) {
        items.push(await this.sendPrivate(executionContext, { userId, text }));
      }

      return {
        ok: items.every(item => item.ok !== false),
        items
      };
    }
  };
}

function createAdminTool(options = {}) {
  const {
    name,
    description,
    service,
    config,
    handler,
    inputSchema
  } = options;

  return {
    name,
    description,
    aliases: [],
    inputSchema,
    outputSchema: {
      type: 'object'
    },
    permission: ['admin'],
    scopes: ['private'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'medium',
    timeoutMs: 15000,
    origin: 'builtin',
    metadata: {
      directMatch: false,
      workflowVisible: true,
      helpVisible: false,
      adminOnly: true
    },
    async execute(context = {}, input = {}) {
      const userId = context.session?.user?.id || context.session?.userId || context.userId || '';
      if (!isAdminUser(config, userId)) {
        return createToolResult({
          ok: false,
          name,
          error: '权限不足：此功能仅限管理员使用'
        });
      }

      return handler(context, input, service);
    }
  };
}

module.exports = {
  name: 'builtin-communication-private-messaging',
  createPrivateMessagingService,
  apply(host, context) {
    const service = createPrivateMessagingService(
      context.getPluginConfig({}),
      context
    );
    host.registerService('communication.private-messaging', service);

    context.registerToolPackage({
      name: 'communication-private-messaging-package',
      version: '0.1.0',
      tools: [
        createAdminTool({
          name: 'communication.private.send',
          description: '向单个明确 uid 的用户发送私聊消息。',
          service,
          config: context.config,
          inputSchema: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              text: { type: 'string' },
              reason: { type: 'string' },
              category: { type: 'string' }
            },
            required: ['userId', 'text']
          },
          async handler(executionContext, input, svc) {
            const result = await svc.sendPrivate(executionContext, input);
            if (!result.ok) {
              return createToolResult({
                ok: false,
                name: 'communication.private.send',
                error: result.error || 'private messaging failed',
                data: result
              });
            }

            const replyText = `已向 uid=${result.userId} 发送私聊消息。`;
            return createToolResult({
              ok: true,
              name: 'communication.private.send',
              result: replyText,
              summary: replyText,
              data: {
                userId: result.userId,
                channelId: result.channelId,
                category: normalizeText(input.category, 32),
                reason: normalizeText(input.reason, 120)
              }
            });
          }
        }),
        createAdminTool({
          name: 'communication.private.bulk_send',
          description: '向多个明确 uid 的用户批量发送同一条私聊消息。',
          service,
          config: context.config,
          inputSchema: {
            type: 'object',
            properties: {
              userIds: {
                type: 'array',
                items: { type: 'string' }
              },
              text: { type: 'string' },
              reason: { type: 'string' },
              category: { type: 'string' }
            },
            required: ['userIds', 'text']
          },
          async handler(executionContext, input, svc) {
            const result = await svc.sendPrivateBatch(executionContext, input);
            if (!result.ok && (!Array.isArray(result.items) || result.items.length === 0)) {
              return createToolResult({
                ok: false,
                name: 'communication.private.bulk_send',
                error: result.error || 'private batch messaging failed',
                data: result
              });
            }

            const items = Array.isArray(result.items) ? result.items : [];
            const successItems = items.filter(item => item.ok !== false);
            const failedItems = items.filter(item => item.ok === false);
            const replyText = failedItems.length > 0
              ? `批量私聊完成：成功 ${successItems.length} 人，失败 ${failedItems.length} 人。`
              : `已向 ${successItems.length} 位用户发送私聊消息。`;

            return createToolResult({
              ok: failedItems.length === 0,
              name: 'communication.private.bulk_send',
              result: replyText,
              summary: replyText,
              error: failedItems.length > 0
                ? failedItems.map(item => `${item.userId || '?'}: ${item.error || 'failed'}`).join('; ')
                : '',
              data: {
                successCount: successItems.length,
                failureCount: failedItems.length,
                successUserIds: successItems.map(item => item.userId),
                failureUserIds: failedItems.map(item => item.userId),
                category: normalizeText(input.category, 32),
                reason: normalizeText(input.reason, 120)
              }
            });
          }
        })
      ],
      skills: [
        {
          id: 'communication.private-messaging',
          name: '私聊沟通',
          summary: '向一个或多个明确 uid 的用户发送私聊消息。',
          description: '适用于管理员警告、提醒、单独通知等场景。',
          toolNames: [
            'communication.private.send',
            'communication.private.bulk_send'
          ],
          tags: ['communication', 'private', 'moderation'],
          adminOnly: true,
          examples: [
            '向 uid=69xxxx 发送私聊提醒',
            '给刚才涉及的几个人分别发送警告私信'
          ],
          metadata: {
            priority: 90,
            pluginName: 'builtin-communication-private-messaging'
          }
        }
      ],
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'communication.private.send',
              'communication.private.bulk_send'
            ],
            instruction: '当管理员要求向一个或多个明确用户发送私聊提醒、警告或跟进通知时，优先使用 communication.private.send / communication.private.bulk_send。若目标用户仅在上下文中被模糊提及，应先调用参与者解析类工具。'
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'communication.private.send',
              'communication.private.bulk_send'
            ],
            instruction: '管理员私聊中如需向其他用户发送提醒或警告，可使用 communication.private.send / communication.private.bulk_send。若目标用户不明确，应先解析近期参与者。'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-communication-private-messaging',
        adminOnly: true,
        description: '管理员私聊消息发送能力'
      }
    });
  }
};
