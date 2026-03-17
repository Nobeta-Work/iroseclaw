/**
 * Trigger templates
 * 按 trigger.kind 约束默认工具集与 workflow 行为
 */

const DEFAULT_TEMPLATE_NAME = 'default';

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function mergeInstruction(baseInstruction, nextInstruction) {
  const base = typeof baseInstruction === 'string' ? baseInstruction.trim() : '';
  const next = typeof nextInstruction === 'string' ? nextInstruction.trim() : '';

  if (!base) return next;
  if (!next) return base;
  if (base === next || base.includes(next)) return base;
  if (next.includes(base)) return next;
  return `${base}\n${next}`;
}

const TRIGGER_TEMPLATES = {
  default: {
    name: DEFAULT_TEMPLATE_NAME,
    toolNames: [
      'help.show',
      'music.play_netease',
      'reply.current',
      'iirose.room.move',
      'iirose.room.current',
      'iirose.room.list',
      'workflow.prompt.style.status',
      'workflow.prompt.style.set',
      'iirose.system.forum.get',
      'iirose.system.tasks.get',
      'iirose.system.leaderboard.get',
      'iirose.user.by_name',
      'iirose.user.profile.by_name',
      'iirose.user.follow_list',
      'iirose.user.profile.self'
    ],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  },
  'message.mentioned': {
    name: 'message.mentioned',
    toolNames: [
      'help.show',
      'music.play_netease',
      'reply.current',
      'iirose.room.move',
      'iirose.room.current',
      'iirose.room.list',
      'workflow.prompt.style.status',
      'workflow.prompt.style.set',
      'iirose.system.forum.get',
      'iirose.system.tasks.get',
      'iirose.system.leaderboard.get',
      'iirose.user.by_name',
      'iirose.user.profile.by_name',
      'iirose.user.follow_list',
      'iirose.user.profile.self'
    ],
    allowDirectToolMatch: true,
    sendFallbackOnError: true,
    useConversationContext: true
  },
  'message.private': {
    name: 'message.private',
    toolNames: [
      'help.show',
      'music.play_netease',
      'reply.current',
      'iirose.room.move',
      'iirose.room.current',
      'iirose.room.list',
      'workflow.prompt.style.status',
      'workflow.prompt.style.set',
      'iirose.system.forum.get',
      'iirose.system.tasks.get',
      'iirose.system.leaderboard.get',
      'iirose.user.by_name',
      'iirose.user.profile.by_name',
      'iirose.user.follow_list',
      'iirose.user.profile.self',
      'monitoring.room.analyze'
    ],
    allowDirectToolMatch: true,
    sendFallbackOnError: true,
    useConversationContext: true,
    instruction: '私聊场景下，管理员可以查询房间状况。如果用户没有指定房间 ID，请询问需要提供房间 ID。'
  },
  'iirose.payment': {
    name: 'iirose.payment',
    toolNames: ['help.show', 'message.route'],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  },
  'iirose.switch_room': {
    name: 'iirose.switch_room',
    toolNames: ['help.show', 'message.route', 'iirose.room.current', 'iirose.room.move', 'iirose.room.subscribe', 'iirose.room.unsubscribe'],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  },
  'iirose.follower': {
    name: 'iirose.follower',
    toolNames: ['help.show', 'message.route'],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  },
  'iirose.broadcast': {
    name: 'iirose.broadcast',
    toolNames: ['help.show'],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  }
};

function normalizeTriggerTemplate(template = {}, baseTemplate = {}) {
  const baseToolNames = normalizeStringArray(baseTemplate.toolNames);
  const incomingToolNames = Array.isArray(template.toolNames)
    ? normalizeStringArray(template.toolNames)
    : null;
  const toolNames = template.replaceToolNames === true
    ? normalizeStringArray(incomingToolNames || [])
    : normalizeStringArray([
        ...baseToolNames,
        ...(incomingToolNames || [])
      ]);

  return {
    name: typeof template.name === 'string' && template.name.trim()
      ? template.name.trim()
      : (typeof baseTemplate.name === 'string' && baseTemplate.name.trim()
        ? baseTemplate.name.trim()
        : DEFAULT_TEMPLATE_NAME),
    toolNames,
    allowDirectToolMatch: typeof template.allowDirectToolMatch === 'boolean'
      ? template.allowDirectToolMatch
      : baseTemplate.allowDirectToolMatch === true,
    sendFallbackOnError: typeof template.sendFallbackOnError === 'boolean'
      ? template.sendFallbackOnError
      : baseTemplate.sendFallbackOnError === true,
    useConversationContext: typeof template.useConversationContext === 'boolean'
      ? template.useConversationContext
      : baseTemplate.useConversationContext !== false,
    instruction: mergeInstruction(baseTemplate.instruction, template.instruction)
  };
}

function getTriggerTemplate(kind = '') {
  const normalizedKind = String(kind || '').trim();
  const template = TRIGGER_TEMPLATES[normalizedKind] || TRIGGER_TEMPLATES.default;
  return normalizeTriggerTemplate(template, {
    name: normalizedKind || DEFAULT_TEMPLATE_NAME
  });
}

function resolveTemplateTools(toolRegistry, template) {
  if (!toolRegistry || typeof toolRegistry.get !== 'function') return [];
  if (!template || !Array.isArray(template.toolNames) || template.toolNames.length === 0) {
    return toolRegistry.list({ workflowVisibleOnly: true });
  }

  const resolved = [];
  for (const name of template.toolNames) {
    const tool = toolRegistry.get(name);
    if (!tool) continue;
    resolved.push({
      name: tool.name,
      description: tool.description,
      aliases: [...tool.aliases],
      permission: [...tool.permission],
      scopes: [...tool.scopes],
      readOnly: tool.readOnly,
      sideEffect: tool.sideEffect,
      riskLevel: tool.riskLevel,
      timeoutMs: tool.timeoutMs,
      origin: tool.origin,
      metadata: { ...tool.metadata }
    });
  }
  return resolved;
}

module.exports = {
  DEFAULT_TEMPLATE_NAME,
  TRIGGER_TEMPLATES,
  normalizeTriggerTemplate,
  getTriggerTemplate,
  resolveTemplateTools
};
