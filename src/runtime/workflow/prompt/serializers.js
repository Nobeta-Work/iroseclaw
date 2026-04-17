/**
 * Workflow prompt serializers
 * 把 trigger/context/tool 元数据转成 provider-neutral 文本片段。
 */

function formatContextMessage(item) {
  if (!item || typeof item !== 'object') return '';
  const role = item.role === 'assistant'
    ? `${item.username || 'BOT'}(uid=${item.userId || 'bot'})`
    : `${item.username || '未知用户'}(uid=${item.userId || 'unknown'})`;
  const mentionLabel = item.isMentionBot ? ' @bot' : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  const rawContent = typeof item.rawContent === 'string' ? item.rawContent.trim() : '';
  const renderedContent = content || rawContent;
  if (!renderedContent) return '';
  const rawSuffix = rawContent && rawContent !== renderedContent
    ? ` | raw=${rawContent}`
    : '';
  return `- ${role}${mentionLabel}: ${renderedContent}${rawSuffix}`;
}

function formatSourceInfo(item = {}) {
  const sourceScope = String(item.sourceScope || '').trim().toLowerCase();
  const scopeLabel = sourceScope === 'private'
    ? '私聊'
    : (sourceScope === 'public' ? '公屏' : '');
  const sourceChannelId = typeof item.sourceChannelId === 'string' ? item.sourceChannelId.trim() : '';
  const sourceTriggerKind = typeof item.sourceTriggerKind === 'string' ? item.sourceTriggerKind.trim() : '';
  const parts = [];

  if (scopeLabel) {
    parts.push(`来源=${scopeLabel}`);
  }
  if (sourceChannelId) {
    parts.push(`位置=${sourceChannelId}`);
  }
  if (sourceTriggerKind) {
    parts.push(`触发=${sourceTriggerKind}`);
  }

  return parts.length > 0 ? `[${parts.join(' | ')}]` : '';
}

function formatSharedContextMessage(item) {
  if (!item || typeof item !== 'object') return '';
  const sourceInfo = formatSourceInfo(item);
  const role = item.role === 'assistant'
    ? `${item.username || 'BOT'}(uid=${item.userId || 'bot'})`
    : `${item.username || '未知用户'}(uid=${item.userId || 'unknown'})`;
  const mentionLabel = item.isMentionBot ? ' @bot' : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  const rawContent = typeof item.rawContent === 'string' ? item.rawContent.trim() : '';
  const renderedContent = content || rawContent;
  if (!renderedContent) return '';
  const rawSuffix = rawContent && rawContent !== renderedContent
    ? ` | raw=${rawContent}`
    : '';
  const sourcePrefix = sourceInfo ? `${sourceInfo} ` : '';
  return `- ${sourcePrefix}${role}${mentionLabel}: ${renderedContent}${rawSuffix}`;
}

function buildPermissionPrompt(protocolRequest = {}) {
  const permission = protocolRequest?.permission || {};
  const lines = [];

  if (permission.isAdmin === true) {
    lines.push('当前触发用户拥有管理员权限。');
    lines.push('在策略允许且工具可见的前提下，可以执行管理员级动作或按管理员身份回答。');
  } else {
    lines.push('当前触发用户不是管理员。');
    lines.push('不要暗示其拥有管理员级能力，也不要为其规划管理员专属动作。');
  }

  if (permission.isSystemRequest === true) {
    lines.push('当前消息包含系统/管理意图。请谨慎判断是否需要工具，而不是直接臆造执行结果。');
  }

  const allowedSkills = Array.isArray(permission.allowedSkills)
    ? permission.allowedSkills.filter(Boolean)
    : [];
  if (allowedSkills.length > 0) {
    lines.push(`当前权限上下文允许的 legacy actions/skills: ${allowedSkills.join(', ')}`);
  }

  return lines;
}

function buildStandardContextPrompt(protocolRequest = {}) {
  const triggerUser = protocolRequest?.context?.triggerUser || {};
  const currentMessage = protocolRequest?.context?.currentMessage || {};
  const recentMessages = Array.isArray(protocolRequest?.context?.recentMessages)
    ? protocolRequest.context.recentMessages
    : [];
  const channelRecentMessages = Array.isArray(protocolRequest?.context?.channelRecentMessages)
    ? protocolRequest.context.channelRecentMessages
    : [];
  const globalSharedRecentMessages = Array.isArray(protocolRequest?.context?.globalSharedRecentMessages)
    ? protocolRequest.context.globalSharedRecentMessages
    : [];
  const globalSharedHistorySummary = Array.isArray(protocolRequest?.context?.globalSharedHistorySummary)
    ? protocolRequest.context.globalSharedHistorySummary
    : [];
  const historySummary = Array.isArray(protocolRequest?.context?.historySummary)
    ? protocolRequest.context.historySummary
    : [];
  const globalSharedAnchorCount = Number.isFinite(Number(protocolRequest?.context?.globalSharedAnchorCount))
    ? Number(protocolRequest.context.globalSharedAnchorCount)
    : 0;

  const blocks = [
    '你正在 IIROSE 群聊环境中回复消息。',
    '必须使用 uid 区分用户，不能把同名用户视为同一人。',
    `当前触发用户: ${triggerUser.name || protocolRequest?.session?.username || '未知用户'} (uid=${triggerUser.id || protocolRequest?.session?.userId || 'unknown'})`,
    `当前房间: ${protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || 'unknown'}`
  ];
  blocks.push(...buildPermissionPrompt(protocolRequest));

  if (historySummary.length > 0) {
    blocks.push('更早历史摘要:');
    for (const item of historySummary) {
      if (typeof item === 'string' && item.trim()) {
        blocks.push(`- ${item.trim()}`);
      }
    }
  }

  if (recentMessages.length > 0) {
    blocks.push('最近与 bot 相关消息(按时间升序):');
    for (const item of recentMessages) {
      const formatted = formatContextMessage(item);
      if (formatted) blocks.push(formatted);
    }
  }

  if (channelRecentMessages.length > 0) {
    blocks.push('当前频道最近消息(按时间升序):');
    for (const item of channelRecentMessages) {
      const formatted = formatContextMessage(item);
      if (formatted) blocks.push(formatted);
    }
  }

  const currentContent = typeof currentMessage.content === 'string'
    ? currentMessage.content.trim()
    : (typeof protocolRequest?.message?.content === 'string' ? protocolRequest.message.content.trim() : '');
  const currentRawContent = typeof currentMessage.rawContent === 'string'
    ? currentMessage.rawContent.trim()
    : '';
  if (currentContent) {
    const rawSuffix = currentRawContent && currentRawContent !== currentContent
      ? ` | raw=${currentRawContent}`
      : '';
    blocks.push(`当前需要回复的消息: ${(currentMessage.username || triggerUser.name || '未知用户')}(uid=${currentMessage.userId || triggerUser.id || 'unknown'}): ${currentContent}${rawSuffix}`);
  }

  if (globalSharedHistorySummary.length > 0) {
    blocks.push('全局共享历史摘要(跨房间/私聊，来源已标注):');
    for (const item of globalSharedHistorySummary) {
      if (typeof item === 'string' && item.trim()) {
        blocks.push(`- ${item.trim()}`);
      }
    }
  }

  if (globalSharedRecentMessages.length > 0) {
    blocks.push('全局共享上下文(跨房间/私聊，来源已标注，不等同于当前房间讨论):');
    for (const item of globalSharedRecentMessages) {
      const formatted = formatSharedContextMessage(item);
      if (formatted) blocks.push(formatted);
    }
  }

  if (globalSharedAnchorCount > 0) {
    blocks.push(`全局共享已记录 @bot 锚点数: ${globalSharedAnchorCount}`);
  }

  blocks.push('请基于上下文只回复当前需要回复的消息，避免混淆历史话题和用户身份。');
  return blocks.join('\n');
}

function buildNativeContextPrompt(protocolRequest = {}) {
  const triggerUser = protocolRequest?.context?.triggerUser || {};
  const currentMessage = protocolRequest?.context?.currentMessage || {};
  const globalSharedRecentMessages = Array.isArray(protocolRequest?.context?.globalSharedRecentMessages)
    ? protocolRequest.context.globalSharedRecentMessages
    : [];
  const globalSharedHistorySummary = Array.isArray(protocolRequest?.context?.globalSharedHistorySummary)
    ? protocolRequest.context.globalSharedHistorySummary
    : [];
  const globalSharedAnchorCount = Number.isFinite(Number(protocolRequest?.context?.globalSharedAnchorCount))
    ? Number(protocolRequest.context.globalSharedAnchorCount)
    : 0;
  const currentContent = typeof currentMessage.content === 'string'
    ? currentMessage.content.trim()
    : (typeof protocolRequest?.message?.content === 'string' ? protocolRequest.message.content.trim() : '');

  const blocks = [
    '你正在 IIROSE 群聊环境中回复消息。',
    '必须使用 uid 区分用户，不能把同名用户视为同一人。',
    `当前房间: ${protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || 'unknown'}`,
    `当前触发用户: ${triggerUser.name || protocolRequest?.session?.username || '未知用户'} (uid=${triggerUser.id || protocolRequest?.session?.userId || 'unknown'})`,
    '同一 session 的历史消息由系统自动保留，不需要你重复复述上下文，也不要臆造不存在的历史。'
  ];
  blocks.push(...buildPermissionPrompt(protocolRequest));

  if (currentContent) {
    blocks.push(`当前需要回复的消息: ${(currentMessage.username || triggerUser.name || '未知用户')}(uid=${currentMessage.userId || triggerUser.id || 'unknown'}): ${currentContent}`);
  }

  if (globalSharedHistorySummary.length > 0) {
    blocks.push('补充的全局共享历史摘要(跨房间/私聊，来源已标注):');
    for (const item of globalSharedHistorySummary) {
      if (typeof item === 'string' && item.trim()) {
        blocks.push(`- ${item.trim()}`);
      }
    }
  }

  if (globalSharedRecentMessages.length > 0) {
    blocks.push('补充的全局共享上下文(与当前 session 记忆不同，来源已标注):');
    for (const item of globalSharedRecentMessages) {
      const formatted = formatSharedContextMessage(item);
      if (formatted) blocks.push(formatted);
    }
  }

  if (globalSharedAnchorCount > 0) {
    blocks.push(`全局共享已记录 @bot 锚点数: ${globalSharedAnchorCount}`);
  }

  blocks.push('请只回复当前消息，保持自然、简短、直接。');
  return blocks.join('\n');
}

function buildContextPrompt(protocolRequest = {}, options = {}) {
  if (options.useNativeSessionContext === true) {
    return buildNativeContextPrompt(protocolRequest);
  }
  return buildStandardContextPrompt(protocolRequest);
}

module.exports = {
  formatContextMessage,
  buildPermissionPrompt,
  buildContextPrompt,
  buildNativeContextPrompt,
  buildStandardContextPrompt
};
