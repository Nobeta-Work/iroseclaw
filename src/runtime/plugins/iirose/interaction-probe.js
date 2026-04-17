/**
 * Builtin plugin: iirose interaction probe
 * 用于验证 [.%uid.] 这类 token 的客户端行为与消息回传。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  maxRecentEvents: 24,
  dataDir: path.resolve(process.cwd(), 'data', 'interaction-probe'),
  targetUsernames: ['艾薇']
};

const PROBE_TOKEN_REGEX = /\[\.%([0-9a-zA-Z_-]{4,80})\.\]/;
const JOIN_COMMAND_REGEX = /(加入|join)%([0-9a-zA-Z_-]{4,80})/i;
const GAME_TEXT_REGEX = /(加入游戏|创建的游戏|已经加入了本场游戏|红包)/;

function normalizeText(value, max = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item, 80)).filter(Boolean);
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.floor(num));
}

function resolveSessionTimestamp(session) {
  const candidates = [
    session?.timestamp,
    session?.event?.timestamp,
    session?.message?.timestamp
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(num);
    }
  }

  return Date.now();
}

function formatRecentEvent(item = {}) {
  const parts = [];
  const username = normalizeText(item.username, 80) || '未知用户';
  const userId = normalizeText(item.userId, 80);
  const kind = normalizeText(item.kind, 40) || 'unknown';
  const content = normalizeText(item.content, 180) || '(空)';
  parts.push(`[${kind}] ${username}${userId ? `(${userId})` : ''}`);
  parts.push(content);
  return parts.join('\n');
}

function logInfo(logger, message) {
  if (logger && typeof logger.INFO === 'function') {
    logger.INFO('PROBE', message);
    return;
  }
  logger?.info?.(message);
}

function buildProbeText(userId, username) {
  const uid = normalizeText(userId, 80);
  const name = normalizeText(username, 80) || '你';
  const customToken = uid ? `[.%probe_${uid.slice(-6)}.]` : '[.%probe_test.]';
  const canonicalToken = uid ? `[.%${uid}.]` : '[.%unknown.]';

  return [
    `交互探针已生成，目标：${name}${uid ? ` (${uid})` : ''}`,
    '',
    `真实 token：${canonicalToken}`,
    `自定义 token：${customToken}`,
    `对照命令：小艾加入%${uid || 'unknown'}`,
    '',
    '测试顺序：',
    '1. 先点击真实 token，看客户端是否弹窗/填充输入框。',
    '2. 再点击自定义 token，看它是否也会被识别。',
    '3. 如果客户端填充了文本，直接发送。',
    '4. 如果没有自动填充，再手动发送对照命令。',
    '',
    '随后用“最近交互探针”查看 bot 观察到的回传。'
  ].join('\n');
}

function createInteractionProbeService(config = {}, logger = console) {
  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    maxRecentEvents: toPositiveInt(config.maxRecentEvents, DEFAULT_CONFIG.maxRecentEvents),
    targetUsernames: normalizeList(config.targetUsernames).length > 0
      ? normalizeList(config.targetUsernames)
      : DEFAULT_CONFIG.targetUsernames
  };
  const recentEvents = [];

  if (finalConfig.persist) {
    fs.mkdirSync(finalConfig.dataDir, { recursive: true });
  }

  function classifyMessage(session = {}) {
    const content = normalizeText(session.content, 1000);
    const username = normalizeText(session.username || session?.user?.name, 80);
    const userId = normalizeText(session.userId || session?.user?.id, 80);
    const channelId = normalizeText(session.channelId || session.guildId || session?.channel?.id, 80);
    const tokenMatch = content.match(PROBE_TOKEN_REGEX);
    const joinMatch = content.match(JOIN_COMMAND_REGEX);
    const isTargetUser = finalConfig.targetUsernames.includes(username);

    if (!content) return null;
    if (!tokenMatch && !joinMatch && !isTargetUser && !GAME_TEXT_REGEX.test(content)) {
      return null;
    }

    let kind = 'related-message';
    if (joinMatch) {
      kind = 'join-command';
    } else if (tokenMatch) {
      kind = 'probe-token';
    } else if (isTargetUser) {
      kind = 'target-bot-message';
    }

    return {
      kind,
      username,
      userId,
      channelId,
      content,
      tokenValue: tokenMatch?.[1] || '',
      joinValue: joinMatch?.[2] || '',
      timestamp: resolveSessionTimestamp(session)
    };
  }

  function persistEvent(event) {
    if (!finalConfig.persist) return;
    const filePath = path.join(finalConfig.dataDir, 'events.jsonl');
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
  }

  return {
    captureSession(session = {}) {
      if (finalConfig.enabled === false) return null;
      const event = classifyMessage(session);
      if (!event) return null;

      recentEvents.push(event);
      if (recentEvents.length > finalConfig.maxRecentEvents) {
        recentEvents.splice(0, recentEvents.length - finalConfig.maxRecentEvents);
      }

      persistEvent(event);
      logInfo(logger, `captured ${event.kind}: ${event.username || 'unknown'} ${event.content}`);
      return event;
    },
    createProbeText(input = {}) {
      return buildProbeText(input.userId, input.username);
    },
    getRecentEvents(options = {}) {
      const limit = toPositiveInt(options.limit, 8);
      const channelId = normalizeText(options.channelId, 80);
      const list = channelId
        ? recentEvents.filter(item => item.channelId === channelId)
        : recentEvents;
      return list.slice(-limit);
    },
    createRecentText(options = {}) {
      const events = this.getRecentEvents(options);
      if (events.length === 0) {
        return '最近没有捕获到交互探针相关消息。';
      }

      return [
        '最近交互探针：',
        ...events.map(formatRecentEvent)
      ].join('\n\n');
    }
  };
}

function createSendProbeTool(service) {
  return {
    name: 'iirose.interaction.probe.send',
    description: '发送 [.%uid.] 交互探针，用于验证 IIROSE 客户端点击后的实际回传。',
    aliases: ['测试交互', '交互测试', '交互探针'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['测试交互', '交互测试', '交互探针']
    },
    async execute(context = {}) {
      const text = service.createProbeText({
        userId: context?.session?.userId || context?.userId || '',
        username: context?.session?.username || context?.username || ''
      });

      return createToolResult({
        ok: true,
        name: 'iirose.interaction.probe.send',
        result: text,
        summary: 'interaction probe emitted'
      });
    }
  };
}

function createRecentProbeTool(service) {
  return {
    name: 'iirose.interaction.probe.recent',
    description: '查看最近捕获到的交互探针相关消息。',
    aliases: ['最近交互探针', '查看交互探针', '交互探针记录'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['最近交互探针', '查看交互探针', '交互探针记录']
    },
    async execute(context = {}) {
      return createToolResult({
        ok: true,
        name: 'iirose.interaction.probe.recent',
        result: service.createRecentText({
          channelId: context?.session?.channelId || ''
        }),
        summary: 'rendered recent interaction probe events'
      });
    }
  };
}

module.exports = {
  name: 'iirose-interaction-probe',
  createInteractionProbeService,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const service = createInteractionProbeService(pluginConfig, context.logger || host.logger || console);

    host.registerService('iirose.interaction-probe', service);

    const cleanup = context.ctx?.on?.('message', (session) => {
      service.captureSession(session);
    });
    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    context.registerToolPackage({
      name: 'iirose-interaction-probe-package',
      version: '0.1.0',
      tools: [
        createSendProbeTool(service),
        createRecentProbeTool(service)
      ],
      skills: [
        {
          id: 'iirose.interaction-probe',
          name: '交互探针',
          summary: '发送并查看 IIROSE 交互探针，用于验证客户端回传行为。',
          toolNames: [
            'iirose.interaction.probe.send',
            'iirose.interaction.probe.recent'
          ],
          tags: ['iirose', 'debug', 'interaction'],
          examples: ['测试交互', '查看交互探针'],
          metadata: {
            priority: 30,
            pluginName: 'iirose-interaction-probe'
          }
        }
      ],
      metadata: {
        pluginName: 'iirose-interaction-probe'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'iirose.interaction.probe.send',
              'iirose.interaction.probe.recent'
            ]
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'iirose.interaction.probe.send',
              'iirose.interaction.probe.recent'
            ]
          }
        }
      ]
    });
  }
};
