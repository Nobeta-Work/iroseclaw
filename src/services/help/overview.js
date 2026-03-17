/**
 * Help overview service
 * 统一生成帮助文本，供 legacy skill 与 canonical tool 复用
 */

function renderHelpOverview(input = {}) {
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const packages = Array.isArray(input.packages) ? input.packages : [];
  const isAdmin = input.isAdmin === true;
  let helpText = '✨ **机器人功能概览** ✨\n\n';
  helpText += '━━━━━━━━━━━━━━━━━━\n\n';

  const hasRuntimeCapabilities = tools.length > 0 || packages.length > 0;

  if (skills.length === 0 && !hasRuntimeCapabilities) {
    helpText += '⚠️ 暂无可用技能\n\n';
  } else if (skills.length > 0) {
    helpText += '🔹 **面向聊天的功能**\n';
    for (const skill of skills) {
      const keywords = skill.keywords?.length > 0
        ? skill.keywords.join(' | ')
        : '无关键词';
      helpText += `   - ${skill.name}: ${skill.description || '无描述'}\n`;
      helpText += `     关键词：${keywords}\n`;
    }
    helpText += '\n';
  }

  const visibleTools = tools
    .filter(isUserVisibleTool)
    .filter(tool => Array.isArray(tool.metadata?.directAliases) && tool.metadata.directAliases.length > 0);
  const userPhrases = uniquePhrases(
    visibleTools.flatMap(tool => tool.metadata.directAliases.slice(0, 2))
  ).slice(0, 12);

  helpText += '🔹 **你可以直接这样说**\n';
  if (userPhrases.length > 0) {
    for (const phrase of userPhrases) {
      helpText += `   - ${phrase}\n`;
    }
  } else {
    helpText += '   - 帮助\n';
    helpText += '   - 点歌 周杰伦\n';
    helpText += '   - 井字棋\n';
    helpText += '   - 猜数字\n';
  }
  helpText += '\n';

  helpText += '🔹 **常见示例**\n';
  helpText += '   - @Bot 帮助\n';
  helpText += '   - @Bot 点歌 晴天\n';
  helpText += '   - @Bot 井字棋 规则\n';
  helpText += '   - @Bot 猜数字 规则\n\n';

  if (isAdmin) {
    const adminPhrases = uniquePhrases(
      tools
        .filter(tool => tool?.metadata?.adminOnly === true)
        .flatMap(tool => Array.isArray(tool?.metadata?.directAliases) ? tool.metadata.directAliases.slice(0, 2) : [])
    ).slice(0, 8);

    if (adminPhrases.length > 0) {
      helpText += '🔹 **管理员快捷指令**\n';
      for (const phrase of adminPhrases) {
        helpText += `   - ${phrase}\n`;
      }
      helpText += '\n';
    }
  }

  helpText += '━━━━━━━━━━━━━━━━━━\n\n';
  helpText += '💡 使用方法：@机器人 + 你的需求\n';
  helpText += isAdmin
    ? '📌 已展示管理员快捷入口，内部执行细节仍保持隐藏\n'
    : '📌 管理/运维类内部操作已隐藏，不在帮助中展示\n';

  return helpText;
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
