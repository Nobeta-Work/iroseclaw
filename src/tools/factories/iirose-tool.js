/**
 * IIROSE tool factory
 * 统一生成 adapter internal API 的查询类工具
 */

const { createToolResult } = require('../../contracts/tool');
const { callInternal } = require('../../services/iirose/internal');

function formatStructuredResult(title, value) {
  if (value === undefined || value === null) {
    return `${title}：未找到结果。`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? `${title}：\n${trimmed}` : `${title}：未找到结果。`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${title}：${String(value)}`;
  }

  try {
    return `${title}：\n${JSON.stringify(value, null, 2)}`;
  } catch {
    return `${title}：${String(value)}`;
  }
}

function createIiroseQueryTool(options = {}) {
  const {
    name,
    description,
    aliases = [],
    permission = [],
    methodName,
    title,
    resolveArgs = () => [],
    formatResult = (value) => formatStructuredResult(title || name, value),
    metadata = {}
  } = options;

  if (!name || !methodName) {
    throw new Error('iirose query tool requires name and methodName');
  }

  return {
    name,
    description: description || '',
    aliases: Array.isArray(aliases) ? [...aliases] : [],
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
    permission: Array.isArray(permission) && permission.length > 0 ? [...permission] : [name],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 15000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      workflowVisible: true,
      ...metadata
    },
    async execute(context = {}, input = {}) {
      try {
        const args = resolveArgs(input, context);
        if (typeof args === 'string') {
          return createToolResult({
            ok: true,
            name,
            result: args,
            summary: args.slice(0, 120)
          });
        }

        const result = await callInternal(context.session, methodName, ...(Array.isArray(args) ? args : []));
        const rendered = formatResult(result, input, context);

        return createToolResult({
          ok: true,
          name,
          result: rendered,
          summary: typeof rendered === 'string' ? rendered.slice(0, 120) : ''
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

function createIiroseActionTool(options = {}) {
  const {
    name,
    description,
    aliases = [],
    permission = [],
    methodName,
    resolveArgs = () => [],
    successMessage = `${name || '操作'}已执行。`,
    metadata = {},
    riskLevel = 'medium',
    scopes = ['current-session']
  } = options;

  if (!name || !methodName) {
    throw new Error('iirose action tool requires name and methodName');
  }

  return {
    name,
    description: description || '',
    aliases: Array.isArray(aliases) ? [...aliases] : [],
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
    permission: Array.isArray(permission) && permission.length > 0 ? [...permission] : [name],
    scopes: Array.isArray(scopes) ? [...scopes] : ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel,
    timeoutMs: 15000,
    origin: 'builtin',
    metadata: {
      directMatch: false,
      workflowVisible: true,
      ...metadata
    },
    async execute(context = {}, input = {}) {
      try {
        const resolved = resolveArgs(input, context);
        if (typeof resolved === 'string') {
          return createToolResult({
            ok: true,
            name,
            result: resolved,
            summary: resolved.slice(0, 120)
          });
        }

        const args = Array.isArray(resolved) ? resolved : [resolved];
        await callInternal(context.session, methodName, ...args);
        return createToolResult({
          ok: true,
          name,
          result: successMessage,
          summary: successMessage.slice(0, 120)
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

module.exports = {
  createIiroseQueryTool,
  createIiroseActionTool,
  formatStructuredResult
};
