/**
 * Builtin plugin: workflow prompt profile
 */

const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');
const { createPromptProfileService } = require('../../workflow/prompt/profile-service');

function normalizeText(value, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function createAdminTool(options = {}) {
  const {
    name,
    description,
    aliases = [],
    directAliases = [],
    config,
    service,
    handler,
    readOnly = false,
    sideEffect = true
  } = options;

  return {
    name,
    description,
    aliases: [...aliases],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' },
        style: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['admin'],
    scopes: ['current-session'],
    readOnly,
    sideEffect,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: [...directAliases],
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

      try {
        const result = await handler({ context, input, service });
        const text = typeof result === 'string' ? result : String(result ?? '');
        return createToolResult({
          ok: true,
          name,
          result: text,
          summary: text.slice(0, 120)
        });
      } catch (error) {
        return createToolResult({
          ok: false,
          name,
          error: error.message
        });
      }
    }
  };
}

function resolveRequestedStyle(input = {}, context = {}, service) {
  const candidates = [
    input.style,
    input.query,
    input.raw,
    context.session?.content,
    context.session?.stripped?.content
  ]
    .map(value => normalizeText(value, 160))
    .filter(Boolean);

  for (const candidate of candidates) {
    const key = service.resolveStyleKey(candidate);
    if (key) return key;
  }

  return '';
}

module.exports = {
  name: 'builtin-workflow-prompt-profile',
  apply(host, context) {
    const promptProfileConfig = context.config?.workflow?.promptProfile || {};
    const service = createPromptProfileService(promptProfileConfig, context.logger || host.logger || console);
    host.registerService('workflow.prompt-profile', service);

    context.registerToolPackage({
      name: 'builtin-workflow-prompt-profile-package',
      version: '0.1.0',
      tools: [
        createAdminTool({
          name: 'workflow.prompt.style.status',
          description: '查看当前 workflow LLM 提示词风格配置。',
          aliases: ['提示词风格', '当前风格', '风格状态'],
          directAliases: ['提示词风格', '当前风格', '风格状态'],
          config: context.config,
          service,
          handler: ({ service: svc }) => svc.createStatusText(),
          readOnly: true,
          sideEffect: false
        }),
        createAdminTool({
          name: 'workflow.prompt.style.set',
          description: '切换 workflow LLM 提示词风格（平淡/热情/爱慕）。',
          aliases: ['切换风格', '设置风格', '风格切换', '平淡模式', '热情模式', '爱慕模式'],
          directAliases: ['切换风格', '设置风格', '风格切换', '平淡模式', '热情模式', '爱慕模式'],
          config: context.config,
          service,
          handler: ({ input, context: toolContext, service: svc }) => {
            const styleKey = resolveRequestedStyle(input, toolContext, svc);
            if (!styleKey) {
              throw new Error('请指定风格：平淡 / 热情 / 爱慕。示例：切换风格 热情');
            }
            const profile = svc.setActiveStyle(styleKey);
            return `已切换提示词风格为：${profile.styleLabel} (${profile.activeStyle})`;
          }
        })
      ],
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: ['workflow.prompt.style.status', 'workflow.prompt.style.set'],
            instruction: '管理员可通过“提示词风格/切换风格 平淡|热情|爱慕”调整机器人回复风格。'
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: ['workflow.prompt.style.status', 'workflow.prompt.style.set'],
            instruction: '管理员私聊可控制 workflow 提示词风格。'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-workflow-prompt-profile'
      }
    });
  }
};
