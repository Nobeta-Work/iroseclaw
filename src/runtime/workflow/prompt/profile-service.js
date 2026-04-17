/**
 * Workflow prompt profile service
 * 提供基于 prompt/*.md 的运行时提示词解析与切换能力，
 * 同时兼容旧的 config.styles 风格配置。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PROMPT_DIR = 'prompt';
const GLOBAL_PROMPT_BASENAME = 'IIC';

function normalizeText(value, max = 300) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizePromptKey(value, max = 120) {
  return normalizeText(value, max).replace(/\.md$/i, '');
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

function getPromptDirectory(config = {}) {
  const promptDir = typeof config.promptDir === 'string' && config.promptDir.trim()
    ? config.promptDir.trim()
    : DEFAULT_PROMPT_DIR;
  return path.resolve(process.cwd(), promptDir);
}

function createPromptFileRecord(fileName, filePath) {
  const key = normalizePromptKey(fileName, 120);
  if (!key) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return null;
  }

  const aliases = Array.from(new Set([
    key,
    key.toLowerCase(),
    fileName,
    fileName.toLowerCase()
  ]))
    .map(item => normalizeText(item, 120))
    .filter(Boolean);

  return {
    key,
    label: key,
    fileName,
    path: filePath,
    isGlobal: key.toLowerCase() === GLOBAL_PROMPT_BASENAME.toLowerCase(),
    content,
    aliases
  };
}

function readPromptFiles(config = {}, logger = console) {
  const promptDir = getPromptDirectory(config);
  if (!fs.existsSync(promptDir)) {
    return {
      promptDir,
      files: []
    };
  }

  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(promptDir, { withFileTypes: true });
  } catch (error) {
    logger.warn?.(`[workflow.prompt-profile] failed to read prompt dir: ${error.message}`);
    return {
      promptDir,
      files: []
    };
  }

  const files = [];
  for (const entry of dirEntries) {
    if (!entry?.isFile?.()) continue;
    if (!/\.md$/i.test(entry.name || '')) continue;
    const filePath = path.join(promptDir, entry.name);
    try {
      const promptFile = createPromptFileRecord(entry.name, filePath);
      if (promptFile) {
        files.push(promptFile);
      }
    } catch (error) {
      logger.warn?.(`[workflow.prompt-profile] failed to read prompt file ${entry.name}: ${error.message}`);
    }
  }

  files.sort((left, right) => left.fileName.localeCompare(right.fileName, 'zh-Hans-CN'));
  return {
    promptDir,
    files
  };
}

function clonePromptFileMeta(promptFile) {
  if (!promptFile || typeof promptFile !== 'object') return null;
  return {
    key: promptFile.key,
    label: promptFile.label,
    fileName: promptFile.fileName,
    path: promptFile.path,
    isGlobal: promptFile.isGlobal === true
  };
}

function matchPromptFileKey(input, files = []) {
  const normalizedInput = normalizePromptKey(input, 160).toLowerCase();
  if (!normalizedInput) return '';

  for (const file of files) {
    const aliases = Array.isArray(file.aliases) ? file.aliases : [];
    const normalizedAliases = aliases.map(item => normalizePromptKey(item, 160).toLowerCase()).filter(Boolean);
    if (normalizedInput === file.key.toLowerCase()) return file.key;
    if (normalizedAliases.includes(normalizedInput)) return file.key;
    if (normalizedAliases.some(alias => normalizedInput.includes(alias))) return file.key;
  }

  return '';
}

function resolveFilePromptSnapshot(config = {}, state = {}, logger = console) {
  const { promptDir, files } = readPromptFiles(config, logger);
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }

  const globalPrompt = files.find(file => file.isGlobal === true) || null;
  const selectableFiles = files.filter(file => file.isGlobal !== true);
  if (selectableFiles.length === 0) {
    return null;
  }

  const configuredActivePrompt = normalizePromptKey(state.activePrompt || config.activePrompt, 120);
  const activePromptKey = matchPromptFileKey(configuredActivePrompt, selectableFiles) || selectableFiles[0].key;
  const activePromptFile = selectableFiles.find(file => file.key === activePromptKey) || selectableFiles[0];
  const promptText = [
    globalPrompt?.content || '',
    activePromptFile?.content || ''
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    mode: 'file',
    promptDir,
    activeStyle: activePromptFile.key,
    activePrompt: activePromptFile.key,
    styleLabel: activePromptFile.label,
    styleInstruction: `当前常态 prompt 文件：${activePromptFile.fileName}`,
    botProfile: {
      name: normalizeText(config.botProfile?.name, 80) || 'IIROSE Claw',
      identity: normalizeText(config.botProfile?.identity, 500) || '',
      extraInstruction: normalizeText(config.botProfile?.extraInstruction, 500) || ''
    },
    globalPrompt: clonePromptFileMeta(globalPrompt),
    activePromptFile: clonePromptFileMeta(activePromptFile),
    availablePromptFiles: selectableFiles.map(clonePromptFileMeta),
    promptFiles: files.map(clonePromptFileMeta),
    promptText
  };
}

function resolveLegacyPromptSnapshot(config = {}, state = {}) {
  const styles = normalizeStyles(config.styles || {});
  const styleKeys = Object.keys(styles);
  const fallbackStyle = styleKeys.includes('plain')
    ? 'plain'
    : (styleKeys[0] || 'plain');
  const activeStyle = normalizeText(state.activeStyle || config.activeStyle, 64).toLowerCase() || fallbackStyle;
  const resolvedActiveStyle = styles[activeStyle] ? activeStyle : fallbackStyle;
  const style = styles[resolvedActiveStyle] || {
    label: resolvedActiveStyle,
    instruction: ''
  };

  return {
    mode: 'legacy',
    promptDir: getPromptDirectory(config),
    activeStyle: resolvedActiveStyle,
    activePrompt: '',
    styleLabel: style.label,
    styleInstruction: style.instruction,
    botProfile: {
      name: normalizeText(config.botProfile?.name, 80) || 'IIROSE Claw',
      identity: normalizeText(config.botProfile?.identity, 500) || '你是一个在 IIROSE 房间中协助聊天与工具编排的机器人助手。',
      extraInstruction: normalizeText(config.botProfile?.extraInstruction, 500)
    },
    globalPrompt: null,
    activePromptFile: null,
    availablePromptFiles: [],
    promptFiles: [],
    promptText: '',
    styles: Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, {
      label: value.label,
      instruction: value.instruction,
      aliases: [...value.aliases]
    }]))
  };
}

function createPromptProfileSnapshot(config = {}, state = {}, logger = console) {
  return resolveFilePromptSnapshot(config, state, logger) || resolveLegacyPromptSnapshot(config, state);
}

function createPromptProfileService(config = {}, logger = console) {
  const state = {
    activeStyle: normalizeText(config.activeStyle, 64).toLowerCase(),
    activePrompt: normalizePromptKey(config.activePrompt, 120)
  };

  const persistEnabled = config.persist !== false;
  const stateFile = typeof config.stateFile === 'string' && config.stateFile.trim()
    ? path.resolve(process.cwd(), config.stateFile.trim())
    : path.resolve(process.cwd(), 'data/runtime/workflow-prompt-profile.json');

  function loadState() {
    if (!persistEnabled) return;
    if (!fs.existsSync(stateFile)) return;

    try {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      const storedActivePrompt = normalizePromptKey(parsed.activePrompt, 120);
      const storedActiveStyle = normalizeText(parsed.activeStyle, 64).toLowerCase();
      if (storedActivePrompt) {
        state.activePrompt = storedActivePrompt;
      }
      if (storedActiveStyle) {
        state.activeStyle = storedActiveStyle;
      }
    } catch (error) {
      logger.warn?.(`[workflow.prompt-profile] failed to load state: ${error.message}`);
    }
  }

  function getSnapshot() {
    const snapshot = createPromptProfileSnapshot(config, state, logger);
    if (snapshot.mode === 'file') {
      state.activePrompt = snapshot.activePrompt;
      state.activeStyle = snapshot.activeStyle;
    } else {
      state.activeStyle = snapshot.activeStyle;
    }
    return snapshot;
  }

  function saveState() {
    if (!persistEnabled) return;

    const snapshot = getSnapshot();
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, `${JSON.stringify({
        activeStyle: snapshot.activeStyle,
        activePrompt: snapshot.activePrompt
      }, null, 2)}\n`, 'utf8');
    } catch (error) {
      logger.warn?.(`[workflow.prompt-profile] failed to persist state: ${error.message}`);
    }
  }

  function resolveStyleKey(rawInput = '') {
    const snapshot = getSnapshot();
    if (snapshot.mode === 'file') {
      return matchPromptFileKey(rawInput, readPromptFiles(config, logger).files);
    }

    const input = normalizeText(rawInput, 120).toLowerCase();
    if (!input) {
      return '';
    }

    for (const [styleKey, style] of Object.entries(snapshot.styles || {})) {
      if (input === styleKey) return styleKey;
      if ((style.aliases || []).some(alias => alias === input || input.includes(alias))) {
        return styleKey;
      }
    }

    return '';
  }

  function setActiveStyle(nextStyle = '') {
    const snapshot = getSnapshot();

    if (snapshot.mode === 'file') {
      const { files } = readPromptFiles(config, logger);
      const resolvedKey = matchPromptFileKey(nextStyle, files);
      const targetFile = files.find(file => file.key === resolvedKey) || null;
      if (!targetFile) {
        const options = files
          .filter(file => file.isGlobal !== true)
          .map(file => file.label)
          .join(' / ');
        throw new Error(`未知提示词：${nextStyle || '(空)'}。可选：${options || '无'}`);
      }

      if (targetFile.isGlobal === true) {
        throw new Error(`${targetFile.fileName} 是全局前置 prompt，不能作为常态 prompt 单独切换`);
      }

      state.activePrompt = targetFile.key;
      saveState();
      return getSnapshot();
    }

    const styleKey = resolveStyleKey(nextStyle) || normalizeText(nextStyle, 64).toLowerCase();
    if (!(snapshot.styles || {})[styleKey]) {
      throw new Error(`未知风格：${nextStyle || '(空)'}。可选：${Object.keys(snapshot.styles || {}).join(' / ')}`);
    }

    state.activeStyle = styleKey;
    saveState();
    return getSnapshot();
  }

  function createStatusText() {
    const snapshot = getSnapshot();
    if (snapshot.mode === 'file') {
      const fileLabels = (snapshot.promptFiles || []).map((file) => (
        file.isGlobal ? `${file.label}(全局前置)` : file.label
      ));
      const lines = [
        '当前提示词配置：',
        '- 模式: 文件读取',
        `- prompt 目录: ${snapshot.promptDir}`,
        `- 当前常态 prompt: ${snapshot.styleLabel || snapshot.activePrompt || '未设置'}`,
        `- 全局前置 prompt: ${snapshot.globalPrompt?.label || '未配置'}`,
        `- 文件列表: ${fileLabels.join(' / ') || '无'}`
      ];

      if (snapshot.activePromptFile?.fileName) {
        lines.push(`- 当前文件: ${snapshot.activePromptFile.fileName}`);
      }

      return lines.join('\n');
    }

    const lines = [
      '当前提示词配置：',
      '- 模式: 兼容风格',
      `- 风格: ${snapshot.styleLabel} (${snapshot.activeStyle})`,
      `- 机器人: ${snapshot.botProfile.name}`,
      '- 可选风格: '
        + Object.entries(snapshot.styles || {})
          .map(([key, style]) => `${style.label}(${key})`)
          .join(' / ')
    ];

    if (snapshot.styleInstruction) {
      lines.push(`- 风格说明: ${snapshot.styleInstruction}`);
    }

    return lines.join('\n');
  }

  loadState();

  return {
    getActiveStyle() {
      return getSnapshot().activeStyle;
    },
    getActivePrompt() {
      return getSnapshot().activePrompt || '';
    },
    listStyles() {
      const snapshot = getSnapshot();
      if (snapshot.mode === 'file') {
        return (snapshot.availablePromptFiles || []).map(file => ({
          key: file.key,
          label: file.label,
          instruction: file.fileName,
          aliases: [file.fileName, file.label]
        }));
      }

      return Object.entries(snapshot.styles || {}).map(([key, value]) => ({
        key,
        label: value.label,
        instruction: value.instruction,
        aliases: [...value.aliases]
      }));
    },
    listPrompts() {
      const snapshot = getSnapshot();
      return (snapshot.promptFiles || []).map(file => ({
        ...file
      }));
    },
    resolveStyleKey,
    resolveProfile() {
      return getSnapshot();
    },
    setActiveStyle,
    createStatusText,
    getStateFile() {
      return stateFile;
    }
  };
}

module.exports = {
  DEFAULT_PROMPT_DIR,
  GLOBAL_PROMPT_BASENAME,
  readPromptFiles,
  createPromptProfileSnapshot,
  createPromptProfileService
};
