/**
 * IIROSE markdown output plugin
 * 为显式 markdown 输出或代码块回复自动注入 IIROSE 渲染前缀。
 */

const {
  containsMarkdownCodeFence,
  hasIiroseMarkdownPrefix,
  withIiroseMarkdownPrefix
} = require('../../../utils/iirose-markdown');

function createIiroseMarkdownOutputPlugin(config = {}) {
  const autoDetectCodeFence = config.autoDetectCodeFence !== false;

  return {
    name: 'iirose-markdown-output',
    async transform(operation) {
      if (!operation || typeof operation !== 'object') return operation;
      if (operation.kind !== 'reply.current' && operation.kind !== 'message.route') {
        return operation;
      }

      const rawText = typeof operation.content?.text === 'string' ? operation.content.text : '';
      if (!rawText.trim()) {
        return operation;
      }

      const explicitMarkdown = operation.content?.renderMode === 'markdown';
      const implicitMarkdown = autoDetectCodeFence && containsMarkdownCodeFence(rawText);
      if (!explicitMarkdown && !implicitMarkdown) {
        return operation;
      }

      if (hasIiroseMarkdownPrefix(rawText)) {
        return {
          ...operation,
          metadata: {
            ...operation.metadata,
            recordText: typeof operation.metadata?.recordText === 'string'
              ? operation.metadata.recordText
              : rawText
          }
        };
      }

      return {
        ...operation,
        content: {
          ...operation.content,
          text: withIiroseMarkdownPrefix(rawText),
          renderMode: 'markdown'
        },
        metadata: {
          ...operation.metadata,
          recordText: typeof operation.metadata?.recordText === 'string'
            ? operation.metadata.recordText
            : rawText
        }
      };
    }
  };
}

module.exports = {
  createIiroseMarkdownOutputPlugin
};
