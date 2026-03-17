/**
 * Fallback response helpers
 * 统一失败兜底词条来源与取词逻辑
 */

const { DEFAULT_CONFIG } = require('../config/runtime');

const DEFAULT_FALLBACK_RESPONSES = Array.isArray(DEFAULT_CONFIG?.fallbackResponses)
  ? [...DEFAULT_CONFIG.fallbackResponses]
  : ['抱歉，我暂时无法处理这个请求。'];

function normalizeFallbackResponses(responses) {
  if (!Array.isArray(responses)) {
    return [...DEFAULT_FALLBACK_RESPONSES];
  }

  const normalized = responses
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  if (normalized.length === 0) {
    return [...DEFAULT_FALLBACK_RESPONSES];
  }

  return normalized;
}

function createFallbackPicker(responses) {
  const normalized = normalizeFallbackResponses(responses);

  return function pickFallback() {
    const index = Math.floor(Math.random() * normalized.length);
    return normalized[index];
  };
}

module.exports = {
  DEFAULT_FALLBACK_RESPONSES,
  normalizeFallbackResponses,
  createFallbackPicker
};
