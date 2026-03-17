/**
 * Meme output plugin
 * 保持表情包模块为输出阶段的一体化增强能力
 */

const { resolveReplyOutput, inferEmotionFromText } = require('../../../utils/meme-format');
const { buildImageEmotionTag } = require('../../../plugins/image-tag-interceptor');

function normalizeProbability(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function createMemeOutputPlugin(config = {}) {
  const enabled = config.enabled !== false;
  const triggerProbability = normalizeProbability(config.triggerProbability, 0.5);

  return {
    name: 'meme-output',
    async expand(operation) {
      if (!operation || typeof operation !== 'object') return operation;
      if (operation.kind !== 'reply.current' && operation.kind !== 'message.route') {
        return operation;
      }

      const useMemePipeline = operation.content?.useMemePipeline === true;
      const rawText = typeof operation.content?.text === 'string' ? operation.content.text : '';
      if (!rawText) {
        return operation;
      }

      const { text: plainReply, emotion: taggedEmotion } = resolveReplyOutput(rawText);
      const baseOperation = {
        ...operation,
        content: {
          ...operation.content,
          text: plainReply
        }
      };

      if (!useMemePipeline || !plainReply.trim()) {
        return baseOperation;
      }

      let emotion = taggedEmotion || '';
      if (!emotion) {
        emotion = typeof operation.content?.emotion === 'string' ? operation.content.emotion : '';
      }
      if (!emotion) {
        emotion = inferEmotionFromText(plainReply);
      }

      const marker = buildImageEmotionTag(emotion);
      const shouldSendMeme = enabled && Boolean(marker) && Math.random() < triggerProbability;
      if (!shouldSendMeme) {
        return baseOperation;
      }

      return [
        baseOperation,
        {
          ...operation,
          operationId: `${operation.operationId}:meme`,
          idempotencyKey: operation.idempotencyKey ? `${operation.idempotencyKey}:meme` : '',
          content: {
            text: marker,
            emotion: '',
            useMemePipeline: false
          },
          options: {
            ...operation.options,
            recordConversation: false
          },
          metadata: {
            ...operation.metadata,
            generatedBy: 'meme-output'
          }
        }
      ];
    }
  };
}

module.exports = {
  createMemeOutputPlugin
};
