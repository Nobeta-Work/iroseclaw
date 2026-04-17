/**
 * IIROSE rose mention helpers
 */

function ensureLeadingRoseMentionSpace(text = '') {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (!value.trim()) {
    return '';
  }

  let result = value;
  const trimmedStart = result.trimStart();
  if (/^\[\*[^\]]+\*\]/.test(trimmedStart) && !/^\s/.test(result)) {
    result = ` ${trimmedStart}`;
  }

  const trimmedEnd = result.trimEnd();
  if (/\[\*[^\]]+\*\]$/.test(trimmedEnd) && !/\s$/.test(result)) {
    result = `${trimmedEnd} `;
  }

  return result;
}

module.exports = {
  ensureLeadingRoseMentionSpace
};
