/**
 * reply.current tool
 * 通过统一 output runtime 回复当前会话
 */

const { normalizeOutputOperation } = require('../../contracts/output');
const { createToolResult } = require('../../contracts/tool');

function createReplyCurrentTool(options = {}) {
  const outputRuntime = options.outputRuntime;

  return {
    name: 'reply.current',
    description: 'Reply to the current active session through the output runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        emotion: { type: 'string' },
        useMemePipeline: { type: 'boolean' },
        renderMode: { type: 'string' },
        idempotencyKey: { type: 'string' }
      },
      required: ['text']
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
      directMatch: false
    },
    async execute(context = {}, input = {}) {
      if (!outputRuntime) {
        return createToolResult({
          ok: false,
          name: 'reply.current',
          error: 'output runtime not configured'
        });
      }

      const operation = normalizeOutputOperation({
        kind: 'reply.current',
        idempotencyKey: input.idempotencyKey,
        content: {
          text: typeof input.text === 'string' ? input.text : '',
          emotion: typeof input.emotion === 'string' ? input.emotion : '',
          useMemePipeline: input.useMemePipeline === true,
          renderMode: typeof input.renderMode === 'string' ? input.renderMode : ''
        }
      });

      const result = await outputRuntime.execute(operation, context);

      return createToolResult({
        ok: result.ok !== false,
        name: 'reply.current',
        result,
        summary: result.summary || ''
      });
    }
  };
}

module.exports = {
  createReplyCurrentTool
};
