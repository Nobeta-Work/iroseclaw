/**
 * Tool package normalize helpers
 */

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function normalizeTriggerTemplates(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => ({
        kind: typeof entry?.kind === 'string' ? entry.kind.trim() : '',
        template: isPlainObject(entry?.template)
          ? { ...entry.template }
          : (isPlainObject(entry) ? { ...entry } : {})
      }))
      .filter(entry => entry.kind);
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([kind, template]) => ({
        kind: String(kind || '').trim(),
        template: isPlainObject(template) ? { ...template } : {}
      }))
      .filter(entry => entry.kind);
  }

  return [];
}

function normalizeSkills(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => isPlainObject(item))
      .map(item => ({ ...item }));
  }

  return [];
}

function normalizeToolPackage(definition = {}) {
  if (!isPlainObject(definition)) {
    throw new TypeError('tool package definition must be an object');
  }

  const name = typeof definition.name === 'string' ? definition.name.trim() : '';
  if (!name) {
    throw new Error('tool package definition requires a name');
  }

  return {
    name,
    version: typeof definition.version === 'string' && definition.version.trim()
      ? definition.version.trim()
      : '0.0.0',
    tools: normalizeArray(definition.tools),
    skills: normalizeSkills(definition.skills || definition.metadata?.skills),
    outputPlugins: normalizeArray(definition.outputPlugins),
    triggerTemplates: normalizeTriggerTemplates(definition.triggerTemplates),
    hooks: normalizeArray(definition.hooks),
    policies: normalizeArray(definition.policies),
    metadata: isPlainObject(definition.metadata) ? { ...definition.metadata } : {}
  };
}

module.exports = {
  normalizeToolPackage
};
