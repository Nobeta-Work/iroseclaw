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
          description: '查看当前 workflow LLM 提示词配置与可切换 prompt 列表。',
          aliases: ['提示词列表', '当前提示词', 'prompt列表', '提示词配置', '当前prompt'],
          directAliases: ['提示词列表', '当前提示词', 'prompt列表', '提示词配置', '当前prompt'],
          config: context.config,
          service,
          handler: ({ service: svc }) => svc.createStatusText(),
          readOnly: true,
          sideEffect: false
        }),
        createAdminTool({
          name: 'workflow.prompt.style.set',
          description: '切换 workflow LLM 当前常态 prompt 文件。',
          aliases: ['切换提示词', '设置提示词', '切换prompt', '设置prompt', 'prompt切换'],
          directAliases: ['切换提示词', '设置提示词', '切换prompt', '设置prompt', 'prompt切换'],
          config: context.config,
          service,
          handler: ({ input, context: toolContext, service: svc }) => {
            const styleKey = resolveRequestedStyle(input, toolContext, svc);
            if (!styleKey) {
              throw new Error('请指定要切换的提示词。示例：切换提示词 女仆');
            }
            const profile = svc.setActiveStyle(styleKey);
            return `已切换当前提示词为：${profile.styleLabel} (${profile.activeStyle})`;
          }
        })
      ],
      skills: [
        {
          id: 'workflow.prompt-management',
          name: '提示词管理',
          summary: '查看和切换 workflow 当前 prompt。',
          toolNames: [
            'workflow.prompt.style.status',
            'workflow.prompt.style.set'
          ],
          tags: ['workflow', 'prompt', 'admin'],
          adminOnly: true,
          metadata: {
            priority: 60,
            pluginName: 'builtin-workflow-prompt-profile'
          }
        }
      ],
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: ['workflow.prompt.style.status', 'workflow.prompt.style.set'],
            instruction: '管理员可通过“提示词列表 / 切换提示词 女仆”查看或切换当前常态 prompt。'
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: ['workflow.prompt.style.status', 'workflow.prompt.style.set'],
            instruction: '管理员私聊可控制 workflow 当前提示词。'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-workflow-prompt-profile'
      }
    });
  }
};
