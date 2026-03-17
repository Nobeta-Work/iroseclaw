/**
 * message.route tool
 * 受 policy 限制的跨会话/跨房间消息发送骨架
 */

const { normalizeOutputOperation } = require('../../contracts/output');
const { createToolResult } = require('../../contracts/tool');

function createMessageRouteTool(options = {}) {
  const outputRuntime = options.outputRuntime;

  return {
    name: 'message.route',
    description: 'Route a message to another allowed channel or private target.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        emotion: { type: 'string' },
        useMemePipeline: { type: 'boolean' },
        idempotencyKey: { type: 'string' },
        target: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            channelId: { type: 'string' },
            userId: { type: 'string' }
          }
        }
      },
      required: ['text', 'target']
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['message.route'],
    scopes: ['channel', 'private'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'high',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: false
    },
    async execute(context = {}, input = {}) {
      if (!outputRuntime) {
        return createToolResult({
          ok: false,
          name: 'message.route',
          error: 'output runtime not configured'
        });
      }

      const operation = normalizeOutputOperation({
        kind: 'message.route',
        idempotencyKey: input.idempotencyKey,
        target: input.target,
        content: {
          text: typeof input.text === 'string' ? input.text : '',
          emotion: typeof input.emotion === 'string' ? input.emotion : '',
          useMemePipeline: input.useMemePipeline === true
        }
      });

      const result = await outputRuntime.execute(operation, context);

      return createToolResult({
        ok: result.ok !== false,
        name: 'message.route',
        result,
        summary: result.summary || '',
        error: result.reason || ''
      });
    }
  };
}

module.exports = {
  createMessageRouteTool
};
