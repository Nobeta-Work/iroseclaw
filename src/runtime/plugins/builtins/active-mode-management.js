/**
 * Builtin plugin: active-mode management
 * 为管理员提供主动模式状态查看与切换能力（私聊直链 + 模型自然语言）
 */

const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');
const {
  resolveRequestedActiveMode,
  ACTIVE_MODE_OPTIONS,
  MODE_LABELS
} = require('../../active-mode/service');

function createActiveModeStatusTool(options = {}) {
  const getActiveModeService = typeof options.getActiveModeService === 'function'
    ? options.getActiveModeService
    : () => null;
  const config = options.config || {};

  return {
    name: 'active.mode.status',
    description: '查看当前主动模式与可用模式列表。',
    aliases: ['主动模式', '主动模式状态', '查看主动模式'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['admin'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['主动模式', '主动模式状态'],
      workflowVisible: true,
      helpVisible: true,
      adminOnly: true
    },
    async execute(context = {}) {
      const userId = context.session?.userId || context.userId || '';
      if (!isAdminUser(config, userId)) {
        return createToolResult({
          ok: false,
          name: 'active.mode.status',
          error: '权限不足：此功能仅限管理员使用'
        });
      }

      const service = getActiveModeService();
      if (!service) {
        return createToolResult({
          ok: false,
          name: 'active.mode.status',
          error: '主动模式服务不可用'
        });
      }

      const text = service.createStatusText();
      return createToolResult({
        ok: true,
        name: 'active.mode.status',
        result: text,
        summary: text.slice(0, 120)
      });
    }
  };
}

function createActiveModeSetTool(options = {}) {
  const getActiveModeService = typeof options.getActiveModeService === 'function'
    ? options.getActiveModeService
    : () => null;
  const config = options.config || {};

  return {
    name: 'active.mode.set',
    description: '切换主动模式。可用模式：无介入模式、伴随模式、高介入模式。',
    aliases: MODE_LABELS.companion
      ? [MODE_LABELS.companion]
      : [],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['admin'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ACTIVE_MODE_OPTIONS.flatMap(option => [option.label, ...option.aliases]),
      workflowVisible: true,
      helpVisible: true,
      adminOnly: true
    },
    async execute(context = {}, input = {}) {
      const userId = context.session?.userId || context.userId || '';
      if (!isAdminUser(config, userId)) {
        return createToolResult({
          ok: false,
          name: 'active.mode.set',
          error: '权限不足：此功能仅限管理员使用'
        });
      }

      const service = getActiveModeService();
      if (!service) {
        return createToolResult({
          ok: false,
          name: 'active.mode.set',
          error: '主动模式服务不可用'
        });
      }

      const raw = String(input.query || input.raw || '').trim();
      const resolved = resolveRequestedActiveMode(raw);
      if (!resolved) {
        const modeList = service.createModeListText();
        return createToolResult({
          ok: false,
          name: 'active.mode.set',
          error: `无法识别模式 "${raw}"。可用模式：\n${modeList}`
        });
      }

      service.setMode(resolved);
      const text = service.createStatusText();
      return createToolResult({
        ok: true,
        name: 'active.mode.set',
        result: text,
        summary: text.slice(0, 120)
      });
    }
  };
}

module.exports = {
  name: 'builtin-active-mode-management',
  apply(host, context) {
    const getActiveModeService = () => host.getService('active-mode');

    context.registerToolPackage({
      name: 'builtin-active-mode-management-package',
      version: '0.1.0',
      tools: [
        createActiveModeStatusTool({
          getActiveModeService,
          config: context.config || {}
        }),
        createActiveModeSetTool({
          getActiveModeService,
          config: context.config || {}
        })
      ],
      skills: [
        {
          id: 'assistant.active-mode-management',
          name: '主动模式管理',
          summary: '查看和切换主动模式（无介入/伴随/高介入）。',
          toolNames: ['active.mode.status', 'active.mode.set'],
          tags: ['admin', 'proactive', 'active-mode'],
          adminOnly: true,
          examples: ['主动模式', '切换到伴随模式', '帮我开启高介入模式'],
          metadata: {
            priority: 60,
            pluginName: 'builtin-active-mode-management'
          }
        }
      ],
      triggerTemplates: [
        {
          kind: 'message.private',
          template: {
            toolNames: ['active.mode.status', 'active.mode.set'],
            instruction: '管理员可以查看或切换主动模式。'
          }
        },
        {
          kind: 'message.mentioned',
          template: {
            toolNames: ['active.mode.status', 'active.mode.set']
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-active-mode-management',
        adminOnly: true,
        description: '主动模式状态查看与切换'
      }
    });

    host.logger?.INFO?.('ACTIVE-MODE', 'Active mode management plugin loaded');
  }
};
