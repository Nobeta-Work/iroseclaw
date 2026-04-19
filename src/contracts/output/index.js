/**
 * Output contract
 * 统一输出操作结构
 */

const { generateRequestId } = require('../../utils/json-utils');

const OUTPUT_KINDS = ['reply.current', 'message.route', 'media.music.send'];
const OUTPUT_RENDER_MODES = ['plain', 'markdown'];

function normalizeRenderMode(value, fallback = 'plain') {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OUTPUT_RENDER_MODES.includes(mode) ? mode : fallback;
}

function normalizeOutputOperation(input = {}) {
  const kind = OUTPUT_KINDS.includes(input.kind) ? input.kind : 'reply.current';
  const target = input.target && typeof input.target === 'object' ? input.target : {};
  const content = input.content && typeof input.content === 'object' ? input.content : {};
  const options = input.options && typeof input.options === 'object' ? input.options : {};

  return {
    operationId: typeof input.operationId === 'string' && input.operationId.trim()
      ? input.operationId.trim()
      : `output_${generateRequestId()}`,
    kind,
    idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '',
    target: {
      scope: typeof target.scope === 'string' && target.scope.trim()
        ? target.scope.trim()
        : 'current-session',
      channelId: typeof target.channelId === 'string' ? target.channelId : '',
      userId: typeof target.userId === 'string' ? target.userId : ''
    },
    content: {
      text: typeof content.text === 'string' ? content.text : '',
      emotion: typeof content.emotion === 'string' ? content.emotion : '',
      useMemePipeline: content.useMemePipeline === true,
      renderMode: normalizeRenderMode(content.renderMode)
    },
    options: {
      recordConversation: options.recordConversation !== false
    },
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
  };
}

module.exports = {
  OUTPUT_KINDS,
  OUTPUT_RENDER_MODES,
  normalizeRenderMode,
  normalizeOutputOperation
};
