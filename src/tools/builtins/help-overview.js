/**
 * help.show tool
 * 提供面向 workflow/runtime 的统一帮助输出
 */

const { createToolResult } = require('../../contracts/tool');
const { renderHelpOverview } = require('../../services/help/overview');
const { isAdminUser } = require('../../runtime/policy/access');

function createHelpOverviewTool(options = {}) {
  const listSkills = typeof options.listSkills === 'function' ? options.listSkills : () => [];
  const listTools = typeof options.listTools === 'function' ? options.listTools : () => [];
  const listPackages = typeof options.listPackages === 'function' ? options.listPackages : () => [];
  const runtimeConfig = options.runtimeConfig && typeof options.runtimeConfig === 'object'
    ? options.runtimeConfig
    : {};
  const getActiveModeService = typeof options.getActiveModeService === 'function'
    ? options.getActiveModeService
    : () => null;

  function resolveActiveModeConfigForHelp() {
    const service = getActiveModeService();
    if (!service) return runtimeConfig;
    const status = service.getStatus();
    const mode = status.mode || 'none';
    return {
      ...runtimeConfig,
      workflow: {
        ...(runtimeConfig.workflow || {}),
        activeMode: {
          ...(runtimeConfig.workflow?.activeMode || {}),
          mode,
          updatedAt: status.updatedAt || status.lastInterventionAt || 0
        }
      }
    };
  }

  return {
    name: 'help.show',
    description: 'Show available robot features and tool overview.',
    aliases: ['帮助', 'help', '命令', '功能', '技能', '指令'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['help'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['帮助']
    },
    async execute(context = {}) {
      const userId = context.session?.userId || context.userId || '';
      const admin = isAdminUser(runtimeConfig, userId);
      const effectiveConfig = resolveActiveModeConfigForHelp();
      const helpText = renderHelpOverview({
        skills: listSkills(),
        tools: listTools(),
        packages: listPackages(),
        isAdmin: admin,
        runtimeConfig: effectiveConfig
      });

      return createToolResult({
        ok: true,
        name: 'help.show',
        result: helpText,
        outputs: [
          {
            kind: 'reply.current',
            content: {
              text: helpText,
              renderMode: 'markdown',
              useMemePipeline: false
            }
          }
        ],
        summary: 'rendered help overview'
      });
    }
  };
}

module.exports = {
  createHelpOverviewTool
};
