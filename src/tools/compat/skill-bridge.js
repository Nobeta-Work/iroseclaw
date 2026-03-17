/**
 * Skill compatibility bridge
 * 将 legacy skill 包装为新 tool contract
 */

const { createToolResult } = require('../../contracts/tool');

function buildLegacySkillArgs(input = {}) {
  const base = input && typeof input === 'object' ? { ...input } : { raw: String(input || '') };
  const raw = typeof base.raw === 'string'
    ? base.raw
    : (typeof base.query === 'string' ? base.query : '');

  return {
    query: typeof base.query === 'string' ? base.query : raw,
    keyword: typeof base.keyword === 'string' ? base.keyword : raw,
    song: typeof base.song === 'string' ? base.song : raw,
    raw
  };
}

function createToolFromSkill(skill = {}, options = {}) {
  if (!skill || !skill.name || typeof skill.handler !== 'function') {
    throw new Error('invalid legacy skill');
  }

  const hiddenSkills = new Set(
    Array.isArray(options.hiddenSkills)
      ? options.hiddenSkills.map(item => String(item || '').trim()).filter(Boolean)
      : []
  );
  const isHidden = hiddenSkills.has(skill.name);

  return {
    name: skill.name,
    description: skill.description || '',
    aliases: Array.isArray(skill.keywords) ? [...skill.keywords] : [],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        keyword: { type: 'string' },
        song: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: [skill.name],
    scopes: ['current-session'],
    readOnly: skill.name === 'help' || skill.name === 'chat',
    sideEffect: skill.name === 'music',
    riskLevel: skill.name === 'music' ? 'medium' : 'low',
    timeoutMs: 30000,
    origin: 'legacy-skill',
    metadata: {
      legacySkillName: skill.name,
      directMatch: !isHidden && Array.isArray(skill.keywords) && skill.keywords.length > 0,
      workflowVisible: !isHidden
    },
    async execute(context = {}, input = {}) {
      const args = buildLegacySkillArgs(input);
      const session = context.session || null;
      const userId = context.userId || session?.userId || '';
      const username = context.username || session?.username || '';

      try {
        const result = await skill.handler({
          session,
          args,
          userId,
          username
        });

        return createToolResult({
          ok: true,
          name: skill.name,
          result,
          summary: typeof result === 'string' ? result.slice(0, 120) : ''
        });
      } catch (error) {
        return createToolResult({
          ok: false,
          name: skill.name,
          error: error.message
        });
      }
    }
  };
}

function bridgeSkillManagerToToolRegistry(skillManager, toolRegistry, options = {}) {
  if (!skillManager || !toolRegistry) {
    throw new Error('bridge requires both skillManager and toolRegistry');
  }

  const mirror = (skill) => {
    if (!skill || !skill.name) {
      return;
    }

    toolRegistry.register(createToolFromSkill(skill, options));
  };

  if (skillManager.skills instanceof Map) {
    for (const skill of skillManager.skills.values()) {
      mirror(skill);
    }
  }

  if (typeof skillManager.onRegister === 'function') {
    return skillManager.onRegister(mirror);
  }

  return () => {};
}

module.exports = {
  createToolFromSkill,
  bridgeSkillManagerToToolRegistry
};
