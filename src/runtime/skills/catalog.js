/**
 * Skill catalog
 * 面向 workflow planner 的能力分组目录，不直接执行。
 */

const { normalizeSkillDefinition, normalizeStringArray } = require('./normalize');

function mergeString(base = '', next = '') {
  return String(base || '').trim() || String(next || '').trim();
}

function mergeMetadata(base = {}, next = {}) {
  return {
    ...(base && typeof base === 'object' ? base : {}),
    ...(next && typeof next === 'object' ? next : {})
  };
}

class SkillCatalog {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.skills = new Map();
  }

  register(definition) {
    const incoming = normalizeSkillDefinition(definition);
    const existing = this.skills.get(incoming.id);

    if (!existing) {
      this.skills.set(incoming.id, incoming);
      return incoming;
    }

    const merged = {
      ...existing,
      name: mergeString(incoming.name, existing.name),
      summary: mergeString(existing.summary, incoming.summary),
      description: mergeString(existing.description, incoming.description),
      tags: normalizeStringArray([...existing.tags, ...incoming.tags]),
      toolNames: normalizeStringArray([...existing.toolNames, ...incoming.toolNames]),
      examples: normalizeStringArray([...existing.examples, ...incoming.examples]),
      adminOnly: existing.adminOnly || incoming.adminOnly,
      triggerKinds: normalizeStringArray([...existing.triggerKinds, ...incoming.triggerKinds]),
      metadata: mergeMetadata(existing.metadata, incoming.metadata)
    };

    this.skills.set(incoming.id, merged);
    return merged;
  }

  get(id = '') {
    return this.skills.get(String(id || '').trim()) || null;
  }

  list() {
    return Array.from(this.skills.values())
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        summary: skill.summary,
        description: skill.description,
        tags: [...skill.tags],
        toolNames: [...skill.toolNames],
        examples: [...skill.examples],
        adminOnly: skill.adminOnly,
        triggerKinds: [...skill.triggerKinds],
        metadata: { ...skill.metadata }
      }))
      .sort((left, right) => {
        const leftPriority = Number.isFinite(Number(left.metadata?.priority))
          ? Number(left.metadata.priority)
          : 0;
        const rightPriority = Number.isFinite(Number(right.metadata?.priority))
          ? Number(right.metadata.priority)
          : 0;
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }
        return left.id.localeCompare(right.id);
      });
  }

  resolveVisibleSkills(visibleTools = [], options = {}) {
    const visibleToolMap = new Map(
      (Array.isArray(visibleTools) ? visibleTools : [])
        .filter(item => item && typeof item === 'object')
        .map(tool => [String(tool.name || '').trim(), tool])
        .filter(([name]) => name)
    );
    const triggerKind = String(options.triggerKind || '').trim();
    const isAdmin = options.isAdmin === true;

    return this.list()
      .filter((skill) => {
        if (skill.adminOnly && !isAdmin) return false;
        if (skill.triggerKinds.length > 0 && triggerKind && !skill.triggerKinds.includes(triggerKind)) {
          return false;
        }
        return skill.toolNames.some(name => visibleToolMap.has(name));
      })
      .map(skill => ({
        ...skill,
        toolNames: skill.toolNames.filter(name => visibleToolMap.has(name)),
        tools: skill.toolNames
          .filter(name => visibleToolMap.has(name))
          .map(name => visibleToolMap.get(name))
      }));
  }
}

module.exports = {
  SkillCatalog
};
