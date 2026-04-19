/**
 * IIROSE markdown render helpers
 */

const IIROSE_MARKDOWN_PREFIX = String.raw`\\\*`;

function normalizeText(value) {
  return typeof value === 'string' ? value : String(value ?? '');
}

function hasIiroseMarkdownPrefix(text = '') {
  const value = normalizeText(text);
  return value === IIROSE_MARKDOWN_PREFIX || value.startsWith(`${IIROSE_MARKDOWN_PREFIX}\n`);
}

function withIiroseMarkdownPrefix(text = '') {
  const value = normalizeText(text);
  if (hasIiroseMarkdownPrefix(value)) {
    return value;
  }
  return `${IIROSE_MARKDOWN_PREFIX}\n${value}`;
}

function containsMarkdownCodeFence(text = '') {
  return /```[\s\S]*```/.test(normalizeText(text));
}

module.exports = {
  IIROSE_MARKDOWN_PREFIX,
  hasIiroseMarkdownPrefix,
  withIiroseMarkdownPrefix,
  containsMarkdownCodeFence
};
