/**
 * Chat-like output plugin
 * 为普通聊天输出提供 `/` 分段和打字延迟元数据。
 */

const { containsMarkdownCodeFence } = require('../../../utils/iirose-markdown');
const { ensureLeadingRoseMentionSpace } = require('../../../utils/iirose-rose-mention');

function normalizeText(value, max = 120000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function isWordLikeChar(char = '') {
  return /[A-Za-z0-9]/.test(char);
}

function shouldSplitAtSlash(text = '', index = -1) {
  if (index <= 0 || index >= text.length - 1) {
    return false;
  }

  const previous = text[index - 1] || '';
  const next = text[index + 1] || '';
  if (!previous || !next) {
    return false;
  }

  if (previous === ':' || previous === '/' || next === '/') {
    return false;
  }

  if (/\s/.test(previous) || /\s/.test(next)) {
    return true;
  }

  if (isWordLikeChar(previous) && isWordLikeChar(next)) {
    return false;
  }

  return true;
}

function splitChatLikeText(text = '', delimiter = '/') {
  const rawText = normalizeText(text);
  if (!rawText) {
    return [];
  }

  if (/[\r\n]/.test(rawText)) {
    const lines = rawText.split(/\r?\n/);
    const hasSlashSegments = lines.some((line, index) => index > 0 && /^\s*\/\s*\S/.test(line));
    if (!hasSlashSegments) {
      return [ensureLeadingRoseMentionSpace(rawText)];
    }

    const segments = [];
    let current = '';

    for (const line of lines) {
      const slashMatch = line.match(/^\s*\/\s*(.*)$/);
      if (slashMatch && slashMatch[1]) {
        const trimmedCurrent = ensureLeadingRoseMentionSpace(normalizeText(current));
        if (trimmedCurrent) {
          segments.push(trimmedCurrent);
        }
        current = slashMatch[1];
        continue;
      }

      current = current ? `${current}\n${line}` : line;
    }

    const tail = ensureLeadingRoseMentionSpace(normalizeText(current));
    if (tail) {
      segments.push(tail);
    }

    return segments.length > 0 ? segments : [rawText];
  }

  if (!delimiter || !rawText.includes(delimiter)) {
    return [ensureLeadingRoseMentionSpace(rawText)];
  }

  if (delimiter !== '/') {
    return rawText
      .split(delimiter)
      .map(item => ensureLeadingRoseMentionSpace(normalizeText(item)))
      .filter(Boolean);
  }

  const segments = [];
  let buffer = '';
  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (char === '/' && shouldSplitAtSlash(rawText, index)) {
      const trimmed = ensureLeadingRoseMentionSpace(normalizeText(buffer));
      if (trimmed) {
        segments.push(trimmed);
      }
      buffer = '';
      continue;
    }
    buffer += char;
  }

  const tail = ensureLeadingRoseMentionSpace(normalizeText(buffer));
  if (tail) {
    segments.push(tail);
  }

  return segments.length > 0 ? segments : [rawText];
}

function countVisibleChars(text = '') {
  return Array.from(String(text || '').replace(/\s+/g, '')).length;
}

function computeTypingDelayMs(text = '', options = {}) {
  const typingDelayPerCharMs = toNonNegativeInt(options.typingDelayPerCharMs, 300);
  const maxTypingDelayMs = toNonNegativeInt(options.maxTypingDelayMs, 5000);
  const visibleChars = countVisibleChars(text);
  const calculatedDelay = visibleChars * typingDelayPerCharMs;
  if (maxTypingDelayMs <= 0) {
    return calculatedDelay;
  }
  return Math.min(calculatedDelay, maxTypingDelayMs);
}

function createChatLikeOutputPlugin(config = {}) {
  const enabled = config.enabled !== false;
  const splitDelimiter = typeof config.splitDelimiter === 'string' && config.splitDelimiter.trim()
    ? config.splitDelimiter.trim().slice(0, 1)
    : '/';
  const typingDelayPerCharMs = toNonNegativeInt(config.typingDelayPerCharMs, 300);
  const maxTypingDelayMs = toNonNegativeInt(config.maxTypingDelayMs, 5000);

  return {
    name: 'chat-like-output',
    async expand(operation) {
      if (!enabled) return operation;
      if (!operation || typeof operation !== 'object') return operation;
      if (operation.kind !== 'reply.current' && operation.kind !== 'message.route') {
        return operation;
      }
      if (operation.metadata?.disableChatLikeOutput === true) {
        return operation;
      }

      const renderMode = String(operation.content?.renderMode || '').trim().toLowerCase();
      const rawText = typeof operation.content?.text === 'string' ? operation.content.text : '';
      if (!rawText.trim()) {
        return operation;
      }
      if (renderMode === 'markdown' || containsMarkdownCodeFence(rawText)) {
        return operation;
      }

      const segments = splitChatLikeText(rawText, splitDelimiter);
      return segments.map((segment, index) => ({
        ...operation,
        content: {
          ...operation.content,
          text: segment
        },
        metadata: {
          ...(operation.metadata && typeof operation.metadata === 'object' ? operation.metadata : {}),
          typingDelayMs: computeTypingDelayMs(segment, {
            typingDelayPerCharMs,
            maxTypingDelayMs
          }),
          recordText: segment,
          chatLikeSegmentIndex: index,
          chatLikeSegmentCount: segments.length
        }
      }));
    }
  };
}

module.exports = {
  ensureLeadingRoseMentionSpace,
  splitChatLikeText,
  computeTypingDelayMs,
  createChatLikeOutputPlugin
};
