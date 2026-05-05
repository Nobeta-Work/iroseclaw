/**
 * Help overview service
 * 统一生成帮助文本，供 legacy skill 与 canonical tool 复用
 */

const PACKAGE_LABELS = {
  'games-tictactoe-package': '井字棋',
  'games-gomoku-package': '五子棋',
  'games-number-guess-package': '猜数字',
  'games-blackjack-package': '21点'
};

function renderHelpOverview(input = {}) {
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const packages = Array.isArray(input.packages) ? input.packages : [];
  const isAdmin = input.isAdmin === true;
  const runtimeConfig = input.runtimeConfig && typeof input.runtimeConfig === 'object'
    ? input.runtimeConfig
    : {};

  const visibleTools = tools
    .filter(isUserVisibleTool)
    .filter(tool => Array.isArray(tool.metadata?.directAliases) && tool.metadata.directAliases.length > 0);
  const packageLabels = collectPackageLabels(packages);
  const userPhrases = collectUserPhrases(visibleTools, packageLabels, skills);
  const activeModeLines = collectActiveModeLines(runtimeConfig, { isAdmin });
  const adminPhrases = isAdmin
    ? uniquePhrases(
      tools
        .filter(tool => tool?.metadata?.adminOnly === true)
        .flatMap(tool => Array.isArray(tool?.metadata?.directAliases) ? tool.metadata.directAliases.slice(0, 2) : [])
    ).slice(0, 5)
    : [];
  const lines = ['## 机器人功能概览'];

  if (userPhrases.length > 0) {
    lines.push(`🔻示例：${userPhrases.map(item => `\`${item}\``).join('、')}`);
  } else {
    lines.push('🔻示例：`帮助`');
  }

  if (activeModeLines.length > 0) {
    lines.push(...activeModeLines);
  }

  if (packageLabels.length > 0) {
    lines.push(`🔻游戏：${packageLabels.join('、')}`);
  } else if (skills.length > 0) {
    lines.push(`🔻已加载技能：${skills.map(skill => skill.name).join('、')}`);
  } else {
    lines.push('🔻暂无可见功能');
  }

  if (isAdmin && adminPhrases.length > 0) {
    lines.push(`🔻管理员快捷：${adminPhrases.map(item => `\`${item}\``).join('、')}`);
    lines.push('🔻已展示管理员快捷入口，内部执行细节仍保持隐藏');
  } else {
    lines.push('🔻管理/运维类内部操作已隐藏');
  }

  return `${lines.join('\n')}\n`;
}

function resolveActiveModeConfig(runtimeConfig = {}) {
  const workflowActiveMode = runtimeConfig.workflow?.activeMode && typeof runtimeConfig.workflow.activeMode === 'object'
    ? runtimeConfig.workflow.activeMode
    : {};
  const topLevelActiveMode = runtimeConfig.activeMode && typeof runtimeConfig.activeMode === 'object'
    ? runtimeConfig.activeMode
    : {};

  return Object.keys(workflowActiveMode).length > 0 ? workflowActiveMode : topLevelActiveMode;
}

function normalizeActiveModeMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['companion', 'company', '伴随模式', '伴随', '陪伴模式'].includes(text)) {
    return '伴随模式';
  }
  if (['high', 'high-intervention', '高介入模式', '高介入'].includes(text)) {
    return '高介入模式';
  }
  return '无介入模式';
}

const ACTIVE_MODE_LABELS = ['无介入模式', '伴随模式', '高介入模式'];

function collectActiveModeLines(runtimeConfig = {}, options = {}) {
  const activeMode = resolveActiveModeConfig(runtimeConfig);
  const referenceKeywords = uniquePhrases(
    Array.isArray(activeMode.reference) ? activeMode.reference : []
  );
  const company = uniquePhrases(Array.isArray(activeMode.company) ? activeMode.company : []);

  if (Object.keys(activeMode).length === 0) {
    return [];
  }

  const lines = [
    `🔻主动模式：${normalizeActiveModeMode(activeMode.mode)}`
  ];

  lines.push(
    `🔻可选模式：${ACTIVE_MODE_LABELS.join('、')}`
  );

  lines.push(
    `🔻触发方式：@ / 关键词 / 引用；主动介入由模式和窗口条件控制`
  );

  lines.push(
    `🔻响应关键词：${referenceKeywords.length > 0 ? referenceKeywords.join('、') : '无'}`
  );

  if (company.length > 0) {
    lines.push(options.isAdmin === true
      ? `🔻陪伴列表：${company.join('、')}`
      : `🔻陪伴列表：已配置 ${company.length} 人`);
  } else {
    lines.push('🔻陪伴列表：未配置');
  }

  const minMessages = Number(activeMode.minMessages || 0);
  const minParticipants = Number(activeMode.minParticipants || 0);
  const windowMs = Number(activeMode.windowMs || 0);
  if (minMessages > 0 && minParticipants > 0 && windowMs > 0) {
    lines.push(`🔻主动窗口：${minMessages} 条消息 / ${minParticipants} 人 / ${Math.round(windowMs / 1000)} 秒`);
  }

  return lines;
}

function isUserVisibleTool(tool = {}) {
  const name = String(tool.name || '').trim();
  if (!name) return false;
  if (name === 'reply.current' || name === 'message.route') return false;
  if (tool.metadata?.helpVisible === false) return false;
  if (tool.metadata?.adminOnly === true) return false;
  if (tool.metadata?.directMatch === false) return false;
  if (tool.sideEffect === true && tool.metadata?.helpVisible !== true) {
    return false;
  }
  return true;
}

function collectPackageLabels(packages = []) {
  return uniquePhrases(
    packages
      .map(item => resolvePackageLabel(item))
      .filter(Boolean)
  );
}

function resolvePackageLabel(item = {}) {
  const packageName = String(item.name || '').trim();
  if (PACKAGE_LABELS[packageName]) {
    return PACKAGE_LABELS[packageName];
  }

  const pluginName = String(item.metadata?.pluginName || '').trim();
  if (pluginName === 'builtin-music') return '点歌';
  if (pluginName === 'builtin-help') return '帮助';
  return '';
}

function collectUserPhrases(visibleTools = [], packageLabels = [], skills = []) {
  const phrases = ['帮助'];
  const directAliases = uniquePhrases(
    visibleTools.flatMap(tool => tool.metadata.directAliases.slice(0, 1))
  );

  if (directAliases.includes('点歌')) {
    phrases.push('点歌 晴天');
  }
  if (packageLabels.includes('井字棋')) phrases.push('井字棋');
  if (packageLabels.includes('五子棋')) phrases.push('五子棋');
  if (packageLabels.includes('猜数字')) phrases.push('猜数字');
  if (packageLabels.includes('21点')) phrases.push('21点开局');

  for (const phrase of directAliases) {
    if (!phrase || phrase === '帮助' || phrase === '点歌') continue;
    if (/状态|规则/.test(phrase)) continue;
    phrases.push(phrase);
  }

  if (phrases.length === 1 && skills.length > 0) {
    for (const skill of skills) {
      const keyword = Array.isArray(skill.keywords) && skill.keywords.length > 0
        ? String(skill.keywords[0] || '').trim()
        : '';
      if (keyword) phrases.push(keyword);
    }
  }

  return uniquePhrases(phrases).slice(0, 6);
}

function uniquePhrases(items = []) {
  return [...new Set(
    items
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

module.exports = {
  renderHelpOverview
};
