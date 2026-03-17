/**
 * Workflow prompt profile service
 * 提供提示词风格/人设的运行时解析与切换能力。
 */

const fs = require('fs');
const path = require('path');

function normalizeText(value, max = 300) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeStyles(styles = {}) {
  const normalized = {};
  for (const [rawKey, rawStyle] of Object.entries(styles || {})) {
    const key = normalizeText(rawKey, 64).toLowerCase();
    if (!key) continue;
    const style = rawStyle && typeof rawStyle === 'object' && !Array.isArray(rawStyle) ? rawStyle : {};
    const label = normalizeText(style.label, 80) || key;
    const instruction = normalizeText(style.instruction, 500);
    const aliases = Array.from(new Set([
      key,
      label,
      ...(Array.isArray(style.aliases) ? style.aliases : [])
    ]))
      .map(item => normalizeText(item, 80).toLowerCase())
      .filter(Boolean);
    normalized[key] = {
      label,
      instruction,
      aliases
    };
  }
  return normalized;
}

function createPromptProfileService(config = {}, logger = console) {
  const styles = normalizeStyles(config.styles || {});
  const styleKeys = Object.keys(styles);
  const fallbackStyle = styleKeys.includes('plain')
    ? 'plain'
    : (styleKeys[0] || 'plain');

  const botProfile = {
    name: normalizeText(config.botProfile?.name, 80) || 'IIROSE Claw',
    identity: normalizeText(config.botProfile?.identity, 500) || '你是一个在 IIROSE 房间中协助聊天与工具编排的机器人助手。',
    extraInstruction: normalizeText(config.botProfile?.extraInstruction, 500)
  };

  const state = {
    activeStyle: normalizeText(config.activeStyle, 64).toLowerCase() || fallbackStyle
  };

  const persistEnabled = config.persist !== false;
  const stateFile = typeof config.stateFile === 'string' && config.stateFile.trim()
    ? path.resolve(process.cwd(), config.stateFile.trim())
    : path.resolve(process.cwd(), 'data/runtime/workflow-prompt-profile.json');

  function ensureActiveStyle() {
    if (!styles[state.activeStyle]) {
      state.activeStyle = fallbackStyle;
    }
  }

  function loadState() {
    if (!persistEnabled) return;
    if (!fs.existsSync(stateFile)) return;

    try {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      const storedStyle = normalizeText(parsed.activeStyle, 64).toLowerCase();
      if (storedStyle) {
        state.activeStyle = storedStyle;
      }
    } catch (error) {
      logger.warn?.(`[workflow.prompt-profile] failed to load state: ${error.message}`);
    }

    ensureActiveStyle();
  }

  function saveState() {
    if (!persistEnabled) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, `${JSON.stringify({ activeStyle: state.activeStyle }, null, 2)}\n`, 'utf8');
    } catch (error) {
      logger.warn?.(`[workflow.prompt-profile] failed to persist state: ${error.message}`);
    }
  }

  function resolveStyleKey(rawInput = '') {
    const input = normalizeText(rawInput, 120).toLowerCase();
    if (!input) return '';

    for (const [styleKey, style] of Object.entries(styles)) {
      if (input === styleKey) return styleKey;
      if (style.aliases.some(alias => alias === input || input.includes(alias))) {
        return styleKey;
      }
    }

    return '';
  }

  function setActiveStyle(nextStyle = '') {
    const styleKey = resolveStyleKey(nextStyle) || normalizeText(nextStyle, 64).toLowerCase();
    if (!styles[styleKey]) {
      throw new Error(`未知风格：${nextStyle || '(空)'}。可选：${Object.keys(styles).join(' / ')}`);
    }

    state.activeStyle = styleKey;
    saveState();
    return resolveProfile();
  }

  function resolveProfile() {
    ensureActiveStyle();
    const style = styles[state.activeStyle] || {
      label: state.activeStyle,
      instruction: ''
    };

    return {
      activeStyle: state.activeStyle,
      styleLabel: style.label,
      styleInstruction: style.instruction,
      botProfile: {
        ...botProfile
      },
      styles: Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, {
        label: value.label,
        instruction: value.instruction,
        aliases: [...value.aliases]
      }]))
    };
  }

  function createStatusText() {
    const profile = resolveProfile();
    const lines = [
      '当前提示词配置：',
      `- 风格: ${profile.styleLabel} (${profile.activeStyle})`,
      `- 机器人: ${profile.botProfile.name}`,
      '- 可选风格: '
        + Object.entries(profile.styles)
          .map(([key, style]) => `${style.label}(${key})`)
          .join(' / ')
    ];

    if (profile.styleInstruction) {
      lines.push(`- 风格说明: ${profile.styleInstruction}`);
    }

    return lines.join('\n');
  }

  loadState();

  return {
    getActiveStyle() {
      ensureActiveStyle();
      return state.activeStyle;
    },
    listStyles() {
      return Object.entries(styles).map(([key, style]) => ({
        key,
        label: style.label,
        instruction: style.instruction,
        aliases: [...style.aliases]
      }));
    },
    resolveStyleKey,
    resolveProfile,
    setActiveStyle,
    createStatusText,
    getStateFile() {
      return stateFile;
    }
  };
}

module.exports = {
  createPromptProfileService
};
