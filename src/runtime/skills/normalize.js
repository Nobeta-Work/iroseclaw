/**
 * Skill normalize helpers
 */

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => normalizeString(item))
      .filter(Boolean)
  )];
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeSkillDefinition(definition = {}) {
  if (!isPlainObject(definition)) {
    throw new TypeError('skill definition must be an object');
  }

  const id = normalizeString(definition.id) || slugify(definition.name);
  if (!id) {
    throw new Error('skill definition requires an id or name');
  }

  const name = normalizeString(definition.name, id);
  const toolNames = normalizeStringArray(definition.toolNames);

  return {
    id,
    name,
    summary: normalizeString(definition.summary),
    description: normalizeString(definition.description),
    tags: normalizeStringArray(definition.tags),
    toolNames,
    examples: normalizeStringArray(definition.examples),
    adminOnly: definition.adminOnly === true,
    triggerKinds: normalizeStringArray(definition.triggerKinds),
    metadata: isPlainObject(definition.metadata) ? { ...definition.metadata } : {}
  };
}

module.exports = {
  normalizeSkillDefinition,
  normalizeStringArray
};
