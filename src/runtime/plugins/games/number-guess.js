/**
 * Builtin plugin: number-guess
 * 猜数字（Bulls and Cows）：机器人出题，房间内多人可参与猜测。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const {
  getSourceSession,
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId,
  getSessionMessageId
} = require('../../../utils/session-metadata');

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  dataDir: path.join(process.cwd(), 'data', 'games-number-guess'),
  stateFile: 'games.json',
  oneGamePerRoom: true,
  allowPrivate: true,
  includeRooms: [],
  excludeRooms: [],
  autoCleanupMs: 60 * 60 * 1000,
  maxQuickInputChars: 32,
  historyPreview: 8,
  allowLeadingZero: false,
  allowRepeatDigits: true,
  minDigits: 3,
  maxDigits: 8,
  defaultDigits: 4,
  defaultMaxAttempts: 10,
  defaultDifficulty: 'normal',
  randomizeDigits: false,
  quoteReply: true,
  requireQuotedGuess: false,
  onlyHostCanManage: true,
  statusKeywords: ['状态', '进度', '猜数字状态'],
  modeKeywords: ['模式', '猜数字模式'],
  restartKeywords: ['重开', '重新开始', '再来一局', '重开猜数字'],
  quitKeywords: ['退出', '结束', '结束猜数字'],
  extendKeywords: ['延长', '延长续命十次', '续命十次', '延长十次', '续命'],
  startKeywords: ['猜数字', '数字游戏', 'bulls and cows', 'ab游戏'],
  difficultyKeywords: {
    easy: ['简单', 'easy'],
    normal: ['普通', '正常', 'normal'],
    hard: ['困难', 'hard'],
    expert: ['地狱', '专家', 'expert', 'hell']
  },
  difficultyPresets: {
    easy: { digits: 3 },
    normal: { digits: 4 },
    hard: { digits: 5 },
    expert: { digits: 6 }
  }
};

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.floor(num));
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function normalizeText(value, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => normalizeText(item, 120)).filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeEpochTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return Date.now();
  return num >= 1e9 && num < 1e12 ? num * 1000 : num;
}

function isPrivateChannel(channelId = '') {
  return String(channelId || '').startsWith('private:');
}

function isRoomAllowed(channelId, config) {
  if (!channelId) return false;
  if (!config.allowPrivate && isPrivateChannel(channelId)) return false;
  if (Array.isArray(config.includeRooms) && config.includeRooms.length > 0 && !config.includeRooms.includes(channelId)) {
    return false;
  }
  if (Array.isArray(config.excludeRooms) && config.excludeRooms.includes(channelId)) {
    return false;
  }
  return true;
}

function getGameKey(session) {
  const channelId = getSessionChannelId(session);
  if (!channelId) return '';
  return `number-guess:${channelId}`;
}

function hasDuplicateDigits(text = '') {
  const seen = new Set();
  for (const ch of String(text)) {
    if (seen.has(ch)) return true;
    seen.add(ch);
  }
  return false;
}

function evaluateGuess(secret, guess) {
  let a = 0;
  let b = 0;
  const secretSet = new Set(String(secret).split(''));

  for (let i = 0; i < guess.length; i += 1) {
    if (guess[i] === secret[i]) {
      a += 1;
    } else if (secretSet.has(guess[i])) {
      b += 1;
    }
  }

  return { a, b };
}

function pickDifficulty(text, config) {
  const normalized = normalizeText(text, 120).toLowerCase();
  if (!normalized) return '';

  for (const [name, aliases] of Object.entries(config.difficultyKeywords || {})) {
    const list = normalizeStringArray(aliases).map(item => item.toLowerCase());
    if (list.some(keyword => normalized.includes(keyword))) {
      return name;
    }
  }
  return '';
}

function pickDigits(text, config) {
  const normalized = normalizeText(text, 120).toLowerCase();
  if (!normalized) return 0;

  const withUnit = normalized.match(/(\d{1,2})\s*(位|位数|digits?)/i);
  if (withUnit) {
    return clampInt(withUnit[1], config.minDigits, config.maxDigits, 0);
  }

  const bare = normalized.match(/\b(\d{1,2})\b/);
  if (bare) {
    return clampInt(bare[1], config.minDigits, config.maxDigits, 0);
  }

  return 0;
}

function pickMaxAttempts(text) {
  const normalized = normalizeText(text, 120).toLowerCase();
  if (!normalized) return 0;

  const matched = normalized.match(/(\d{1,3})\s*(次|轮|attempts?)/i);
  if (!matched) return 0;
  return toPositiveInt(matched[1], 0);
}

function parseGuessText(rawText = '') {
  const text = normalizeText(rawText, 80);
  if (!text) return '';

  if (/^\d+$/.test(text)) return text;
  const prefixed = text.match(/^(?:猜|guess)\s*([0-9]+)$/i);
  if (prefixed) return prefixed[1];
  return '';
}

function normalizeDifficultyName(name, config) {
  const normalized = normalizeText(name, 60).toLowerCase();
  if (!normalized) return '';
  if (config.difficultyPresets && config.difficultyPresets[normalized]) return normalized;
  return '';
}

function formatDifficultyLabel(name) {
  const map = {
    easy: '简单',
    normal: '普通',
    hard: '困难',
    expert: '地狱'
  };
  return map[name] || name || '普通';
}

function createSecret(digits, options = {}) {
  const size = clampInt(digits, 1, 10, 4);
  const allowLeadingZero = options.allowLeadingZero === true;
  const allowRepeat = options.allowRepeatDigits === true;

  if (allowRepeat) {
    let value = '';
    for (let i = 0; i < size; i += 1) {
      value += String(Math.floor(Math.random() * 10));
    }
    if (!allowLeadingZero && value[0] === '0') {
      value = String(Math.floor(Math.random() * 9) + 1) + value.slice(1);
    }
    return value;
  }

  const pool = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const result = [];
  for (let i = 0; i < size; i += 1) {
    if (i === 0 && !allowLeadingZero) {
      const nonZeroPool = pool.filter(item => item !== '0');
      const picked = nonZeroPool[Math.floor(Math.random() * nonZeroPool.length)];
      result.push(picked);
      pool.splice(pool.indexOf(picked), 1);
      continue;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    result.push(picked);
    pool.splice(pool.indexOf(picked), 1);
  }
  return result.join('');
}

function createGameStore(config = {}) {
  const dataDir = path.resolve(config.dataDir || DEFAULT_CONFIG.dataDir);
  const filePath = path.resolve(dataDir, config.stateFile || DEFAULT_CONFIG.stateFile);
  let games = config.persist !== false ? readJsonFile(filePath, {}) : {};

  function cleanupExpired() {
    const now = Date.now();
    const autoCleanupMs = toPositiveInt(config.autoCleanupMs, DEFAULT_CONFIG.autoCleanupMs);
    let changed = false;

    for (const [key, game] of Object.entries(games)) {
      const updatedAt = normalizeEpochTimestamp(game?.updatedAt);
      if (!updatedAt || now - updatedAt < autoCleanupMs) continue;
      delete games[key];
      changed = true;
    }

    if (changed && config.persist !== false) {
      writeJsonFile(filePath, games);
    }
  }

  function persist() {
    if (config.persist === false) return;
    writeJsonFile(filePath, games);
  }

  return {
    get(key) {
      cleanupExpired();
      const value = games[key];
      return value ? clone(value) : null;
    },
    set(key, value) {
      cleanupExpired();
      games[key] = clone(value);
      persist();
      return this.get(key);
    },
    delete(key) {
      cleanupExpired();
      delete games[key];
      persist();
    },
    list() {
      cleanupExpired();
      return clone(games);
    }
  };
}

function buildExecutionContext(context, pluginContext) {
  return {
    session: context.session,
    userId: getSessionUserId(context.session),
    username: getSessionUsername(context.session),
    channelId: getSessionChannelId(context.session),
    ctx: pluginContext.ctx,
    logger: pluginContext.logger,
    policyEngine: pluginContext.policyEngine,
    botProfile: {
      uid: pluginContext.config?.bot?.uid || '',
      name: pluginContext.config?.bot?.name || ''
    }
  };
}

function getSessionQuoteMessageId(session) {
  const source = getSourceSession(session);
  const candidates = [
    session?.quote?.messageId,
    session?.quote?.id,
    session?.event?.message?.quote?.messageId,
    session?.event?.message?.quote?.id,
    source?.quote?.messageId,
    source?.quote?.id,
    source?.event?.message?.quote?.messageId,
    source?.event?.message?.quote?.id
  ];
  for (const item of candidates) {
    const text = normalizeText(item, 120);
    if (text) return text;
  }
  return '';
}

function createNumberGuessService(options = {}) {
  const minDigits = clampInt(options.minDigits, 1, 10, DEFAULT_CONFIG.minDigits);
  const maxDigits = clampInt(options.maxDigits, minDigits, 10, DEFAULT_CONFIG.maxDigits);
  const defaultDigits = clampInt(options.defaultDigits, minDigits, maxDigits, DEFAULT_CONFIG.defaultDigits);

  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    minDigits,
    maxDigits,
    defaultDigits,
    defaultMaxAttempts: toPositiveInt(options.defaultMaxAttempts, DEFAULT_CONFIG.defaultMaxAttempts),
    maxQuickInputChars: toPositiveInt(options.maxQuickInputChars, DEFAULT_CONFIG.maxQuickInputChars),
    historyPreview: toPositiveInt(options.historyPreview, DEFAULT_CONFIG.historyPreview),
    includeRooms: normalizeStringArray(options.includeRooms ?? DEFAULT_CONFIG.includeRooms),
    excludeRooms: normalizeStringArray(options.excludeRooms ?? DEFAULT_CONFIG.excludeRooms),
    statusKeywords: normalizeStringArray(options.statusKeywords ?? DEFAULT_CONFIG.statusKeywords),
    modeKeywords: normalizeStringArray(options.modeKeywords ?? DEFAULT_CONFIG.modeKeywords),
    restartKeywords: normalizeStringArray(options.restartKeywords ?? DEFAULT_CONFIG.restartKeywords),
    quitKeywords: normalizeStringArray(options.quitKeywords ?? DEFAULT_CONFIG.quitKeywords),
    extendKeywords: normalizeStringArray(options.extendKeywords ?? DEFAULT_CONFIG.extendKeywords),
    startKeywords: normalizeStringArray(options.startKeywords ?? DEFAULT_CONFIG.startKeywords),
    difficultyKeywords: {
      easy: normalizeStringArray(options.difficultyKeywords?.easy ?? DEFAULT_CONFIG.difficultyKeywords.easy),
      normal: normalizeStringArray(options.difficultyKeywords?.normal ?? DEFAULT_CONFIG.difficultyKeywords.normal),
      hard: normalizeStringArray(options.difficultyKeywords?.hard ?? DEFAULT_CONFIG.difficultyKeywords.hard),
      expert: normalizeStringArray(options.difficultyKeywords?.expert ?? DEFAULT_CONFIG.difficultyKeywords.expert)
    },
    difficultyPresets: {
      ...DEFAULT_CONFIG.difficultyPresets,
      ...(options.difficultyPresets && typeof options.difficultyPresets === 'object'
        ? options.difficultyPresets
        : {})
    },
    defaultDifficulty: normalizeDifficultyName(options.defaultDifficulty, {
      difficultyPresets: {
        ...DEFAULT_CONFIG.difficultyPresets,
        ...(options.difficultyPresets && typeof options.difficultyPresets === 'object'
          ? options.difficultyPresets
          : {})
      }
    }) || DEFAULT_CONFIG.defaultDifficulty
  };

  const store = options.store || createGameStore(config);
  const chooseSecret = typeof options.secretGenerator === 'function'
    ? options.secretGenerator
    : createSecret;
  const roomModeStore = options.roomModeStore instanceof Map ? options.roomModeStore : new Map();

  function getRoomRepeatMode(session) {
    const channelId = getSessionChannelId(session);
    if (!channelId) return config.allowRepeatDigits === true;
    if (roomModeStore.has(channelId)) {
      return roomModeStore.get(channelId) === true;
    }
    return config.allowRepeatDigits === true;
  }

  function setRoomRepeatMode(session, allowRepeat) {
    const channelId = getSessionChannelId(session);
    if (!channelId) return;
    roomModeStore.set(channelId, allowRepeat === true);
  }

  function parseModeDirective(input = {}) {
    const sources = [input.mode, input.query, input.raw, input.args];
    const merged = sources
      .map(item => normalizeText(item, 160).toLowerCase())
      .filter(Boolean)
      .join(' ');
    if (!merged) return '';

    if (/不重复|无重复|禁止重复|唯一/.test(merged)) return 'unique';
    if (/可重复|允许重复|重复/.test(merged)) return 'repeat';
    if (/切换|toggle/.test(merged)) return 'toggle';
    return '';
  }

  function resolvePresetDigits(preset = {}) {
    if (Number.isFinite(Number(preset.digits))) {
      return clampInt(preset.digits, config.minDigits, config.maxDigits, config.defaultDigits);
    }
    if (Array.isArray(preset.digitsRange) && preset.digitsRange.length >= 1) {
      return clampInt(preset.digitsRange[0], config.minDigits, config.maxDigits, config.defaultDigits);
    }
    return config.defaultDigits;
  }

  function createState(session, startOptions = {}) {
    const userId = getSessionUserId(session) || 'unknown';
    const username = getSessionUsername(session) || '玩家';
    const channelId = getSessionChannelId(session);
    const now = Date.now();
    const digits = clampInt(startOptions.digits, config.minDigits, config.maxDigits, config.defaultDigits);
    const maxAttempts = toPositiveInt(startOptions.maxAttempts, config.defaultMaxAttempts);
    const difficultyName = normalizeDifficultyName(startOptions.difficulty, config) || config.defaultDifficulty;
    const allowRepeatDigits = startOptions.allowRepeatDigits === true;
    const secret = String(chooseSecret(digits, { ...config, allowRepeatDigits }));

    return {
      id: getGameKey(session),
      channelId,
      hostId: userId,
      hostName: username,
      status: 'playing',
      difficulty: difficultyName,
      digits,
      allowRepeatDigits,
      maxAttempts,
      secret,
      attempts: [],
      participantStats: {
        [userId]: { id: userId, name: username, guesses: 0 }
      },
      winnerId: '',
      winnerName: '',
      createdAt: now,
      updatedAt: now,
      anchorMessageId: getSessionMessageId(session) || ''
    };
  }

  function getGame(session) {
    const key = getGameKey(session);
    if (!key) return null;
    return store.get(key);
  }

  function setGame(session, nextState) {
    const key = getGameKey(session);
    if (!key) return null;
    return store.set(key, { ...nextState, updatedAt: Date.now() });
  }

  function deleteGame(session) {
    const key = getGameKey(session);
    if (!key) return;
    store.delete(key);
  }

  function createStatusText(state) {
    const lines = [];
    const total = Array.isArray(state.attempts) ? state.attempts.length : 0;
    const attemptsLimit = state.maxAttempts > 0 ? `${total}/${state.maxAttempts}` : `${total}/∞`;
    lines.push(`猜数字（${state.digits} 位 / ${state.allowRepeatDigits ? '可重复' : '不重复'}）`);
    lines.push(`难度: ${state.difficulty}`);
    lines.push(`状态: ${state.status}`);
    lines.push(`已猜次数: ${attemptsLimit}`);

    if (state.status === 'won') {
      lines.push(`结果: ${state.winnerName || '未知玩家'} 猜中了，答案是 ${state.secret}`);
    } else if (state.status === 'lost') {
      lines.push('结果: 次数耗尽，本局待处理。');
      lines.push('可用操作: 延长（+10 次） / 退出');
    } else {
      lines.push('规则: A=数字和位置都正确，B=数字正确但位置错误');
      lines.push(`提示: 直接发送 ${state.digits} 位数字即可参与`);
    }

    const recent = Array.isArray(state.attempts)
      ? state.attempts.slice(-config.historyPreview)
      : [];
    if (recent.length > 0) {
      lines.push('最近记录:');
      for (const item of recent) {
        lines.push(`- ${item.username}: ${item.guess} -> ${item.a}A${item.b}B`);
      }
    }

    return lines.join('\n');
  }

  function getRulesText() {
    const difficultyLines = Object.entries(config.difficultyPresets || {}).map(([name, preset]) => {
      const digits = resolvePresetDigits(preset);
      const label = formatDifficultyLabel(name);
      return `- ${label}：发送“猜数字 ${label}”开启，固定 ${digits} 位`;
    });

    const lines = [
      '猜数字规则',
      '1) 机器人会生成一个隐藏数字，位数由难度固定决定（玩家不可指定位数）。',
      '2) 你发送一个同位数数字进行猜测。',
      '3) 返回格式为 xAyB：A=数字和位置都正确，B=数字正确但位置错误。',
      '4) 房间内所有人都可以猜，直到有人猜中或次数耗尽。',
      '5) 每局基础次数统一为 10 次。',
      '6) 次数耗尽后可发送“延长”继续当前局（+10 次），或发送“退出”结束并公布答案。'
    ];
    lines.push(`默认难度: ${formatDifficultyLabel(config.defaultDifficulty)}`);
    lines.push(`默认最大次数: ${config.defaultMaxAttempts}`);
    lines.push(`默认限制: ${config.allowRepeatDigits ? '允许重复数字' : '不允许重复数字'} / ${config.allowLeadingZero ? '允许前导 0' : '首位不可为 0'}`);
    lines.push('难度档说明:');
    lines.push(...difficultyLines);
    lines.push('常用命令: 猜数字、猜数字 简单/普通/困难/地狱、猜数字 模式、状态、重开、退出、延长、猜数字 规则');
    return lines.join('\n');
  }

  function resolveStartOptions(input = {}) {
    const sources = [
      input.query,
      input.raw,
      input.mode,
      input.difficulty,
      input.level,
      input.args
    ].map(item => normalizeText(item, 160)).filter(Boolean);
    const merged = sources.join(' ');

    const explicitDifficulty = normalizeDifficultyName(
      normalizeText(input.difficulty || input.level, 60),
      config
    );
    const difficulty = explicitDifficulty || pickDifficulty(merged, config) || config.defaultDifficulty;
    const preset = config.difficultyPresets[difficulty] || {};
    const digits = resolvePresetDigits(preset);
    const maxAttempts = config.defaultMaxAttempts;
    const allowRepeatDigits = getRoomRepeatMode(input.session || {});

    return {
      difficulty,
      digits,
      maxAttempts,
      allowRepeatDigits
    };
  }

  function startGame(session, input = {}) {
    const channelId = getSessionChannelId(session);
    if (!channelId) {
      return {
        ok: false,
        error: '无法识别当前会话频道。'
      };
    }
    if (!isRoomAllowed(channelId, config)) {
      return {
        ok: false,
        error: '当前房间不在猜数字插件允许范围内。'
      };
    }

    const current = getGame(session);
    if (current && config.oneGamePerRoom) {
      return {
        ok: false,
        error: `本房间已有进行中的猜数字对局。\n${createStatusText(current)}`
      };
    }

    const startOptions = resolveStartOptions({
      ...input,
      session
    });
    if (!startOptions.allowRepeatDigits && startOptions.digits > 10) {
      return {
        ok: false,
        error: '不允许重复数字时，位数不能超过 10。'
      };
    }

    const next = createState(session, startOptions);
    setGame(session, next);

    const lines = [
      `猜数字已开始（${next.difficulty} / ${next.digits} 位 / ${next.maxAttempts} 次）`,
      '规则: A=数字和位置都正确，B=数字正确但位置错误',
      `请直接发送 ${next.digits} 位数字参与猜测（房间内所有人都可以猜）`,
      '支持命令: 状态 / 重开 / 退出 / 延长续命十次(失败后)'
    ];
    if (!next.allowRepeatDigits) {
      lines.push('限制: 数字不能重复');
    } else {
      lines.push('模式: 允许重复数字');
    }
    if (config.requireQuotedGuess) {
      lines.push('限制: 猜测需要通过“回复消息”发送');
    }

    return {
      ok: true,
      text: lines.join('\n'),
      state: next
    };
  }

  function touchParticipant(state, userId, username) {
    if (!state.participantStats || typeof state.participantStats !== 'object') {
      state.participantStats = {};
    }
    if (!state.participantStats[userId]) {
      state.participantStats[userId] = { id: userId, name: username, guesses: 0 };
    } else if (username) {
      state.participantStats[userId].name = username;
    }
    state.participantStats[userId].guesses += 1;
  }

  function applyGuess(session, rawGuess, meta = {}) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const username = getSessionUsername(session) || '玩家';
    const guess = parseGuessText(rawGuess);

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的猜数字。发送“@Bot 猜数字”开始。'
      };
    }
    if (current.status !== 'playing') {
      return {
        ok: false,
        error: '本局已结束。发送“延长”继续当前局，或发送“退出”结束并公布答案。'
      };
    }
    if (!guess) {
      return {
        ok: false,
        error: `请输入 ${current.digits} 位数字，例如 ${'1'.repeat(current.digits)}。`
      };
    }
    if (config.requireQuotedGuess && !normalizeText(meta.quoteMessageId, 120)) {
      return {
        ok: false,
        error: '当前房间要求使用“回复消息”方式提交猜测。'
      };
    }
    if (!/^\d+$/.test(guess)) {
      return {
        ok: false,
        error: '猜测内容只能包含数字。'
      };
    }
    if (guess.length !== current.digits) {
      return {
        ok: false,
        error: `请输入 ${current.digits} 位数字。`
      };
    }
    if (!config.allowLeadingZero && guess.startsWith('0')) {
      return {
        ok: false,
        error: '首位不能是 0。'
      };
    }
    if (!current.allowRepeatDigits && hasDuplicateDigits(guess)) {
      return {
        ok: false,
        error: '数字不能包含重复位。'
      };
    }

    const next = clone(current);
    const { a, b } = evaluateGuess(next.secret, guess);
    const record = {
      userId,
      username,
      guess,
      a,
      b,
      at: Date.now(),
      messageId: getSessionMessageId(session) || ''
    };
    next.attempts.push(record);
    touchParticipant(next, userId, username);

    const used = next.attempts.length;
    const limitReached = next.maxAttempts > 0 && used >= next.maxAttempts;
    const left = next.maxAttempts > 0 ? Math.max(next.maxAttempts - used, 0) : -1;

    let lines = [`${username} 猜 ${guess} -> ${a}A${b}B`];

    if (a === next.digits) {
      next.status = 'won';
      next.winnerId = userId;
      next.winnerName = username;
      lines = lines.concat([
        `恭喜 ${username} 猜中答案 ${next.secret}！`,
        `总猜测次数: ${used}`
      ]);
    } else if (limitReached) {
      next.status = 'lost';
      lines = lines.concat([
        '已达到最大猜测次数，本局结束。',
        '你可以发送“延长”继续 +10 次，或发送“退出”结束本局并公布答案。'
      ]);
    } else if (left >= 0) {
      lines.push(`剩余次数: ${left}`);
    }

    setGame(session, next);
    return {
      ok: true,
      text: lines.join('\n'),
      state: next,
      result: record
    };
  }

  function restartGame(session, input = {}) {
    const current = getGame(session);

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的猜数字。'
      };
    }

    deleteGame(session);
    return startGame(session, input);
  }

  function quitGame(session) {
    const current = getGame(session);
    const username = getSessionUsername(session) || '玩家';

    if (!current) {
      return {
        ok: true,
        text: '当前没有进行中的猜数字。'
      };
    }
    const answer = current.secret;
    deleteGame(session);
    return {
      ok: true,
      text: `${username} 已结束当前猜数字对局。\n答案是: ${answer}`
    };
  }

  function extendLife(session) {
    const current = getGame(session);
    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的猜数字。'
      };
    }
    if (current.status !== 'lost') {
      return {
        ok: false,
        error: '只有在次数耗尽失败后，才能使用“延长续命十次”。'
      };
    }

    const next = clone(current);
    next.maxAttempts += 10;
    next.status = 'playing';
    setGame(session, next);
    const used = next.attempts.length;
    const left = Math.max(next.maxAttempts - used, 0);
    return {
      ok: true,
      text: `续命成功，已增加 10 次机会。\n当前总次数: ${next.maxAttempts}\n剩余次数: ${left}\n继续发送 ${next.digits} 位数字猜测。`,
      state: next
    };
  }

  function getStatusText(session) {
    const current = getGame(session);
    if (!current) {
      return {
        ok: true,
        text: '当前没有进行中的猜数字。发送“@Bot 猜数字”开始。'
      };
    }
    return {
      ok: true,
      text: createStatusText(current),
      state: current
    };
  }

  function setMode(session, input = {}) {
    const currentMode = getRoomRepeatMode(session);
    const directive = parseModeDirective(input);
    if (!directive) {
      return {
        ok: true,
        text: `当前猜数字模式：${currentMode ? '可重复数字' : '不重复数字'}。\n使用“猜数字 模式 可重复”或“猜数字 模式 不重复”切换。`
      };
    }

    const nextMode = directive === 'toggle'
      ? !currentMode
      : (directive === 'repeat');
    setRoomRepeatMode(session, nextMode);

    const current = getGame(session);
    const suffix = current && current.status === 'playing'
      ? '\n当前进行中的对局不变，新模式从下一局开始生效。'
      : '';
    return {
      ok: true,
      text: `猜数字模式已切换为：${nextMode ? '可重复数字' : '不重复数字'}。${suffix}`
    };
  }

  function parseQuickInput(session) {
    const current = getGame(session);
    if (!current) return null;

    const rawText = normalizeText(session?.content, 80);
    if (!rawText || rawText.length > config.maxQuickInputChars) return null;
    if (/<at\b|id="/i.test(rawText)) return null;

    if (config.statusKeywords.includes(rawText)) {
      return { type: 'status' };
    }
    if (config.restartKeywords.includes(rawText)) {
      return { type: 'restart' };
    }
    if (config.quitKeywords.includes(rawText)) {
      return { type: 'quit' };
    }
    if (config.extendKeywords.includes(rawText)) {
      return { type: 'extend' };
    }

    const guess = parseGuessText(rawText);
    if (guess) {
      return {
        type: 'guess',
        value: guess
      };
    }
    return null;
  }

  function handleQuickInput(session) {
    const parsed = parseQuickInput(session);
    if (!parsed) return null;
    if (parsed.type === 'guess') {
      return applyGuess(session, parsed.value, {
        quoteMessageId: getSessionQuoteMessageId(session)
      });
    }
    if (parsed.type === 'restart') {
      return restartGame(session, {});
    }
    if (parsed.type === 'quit') {
      return quitGame(session);
    }
    if (parsed.type === 'extend') {
      return extendLife(session);
    }
    return getStatusText(session);
  }

  return {
    config: { ...config },
    startGame,
    applyGuess,
    restartGame,
    quitGame,
    extendLife,
    setMode,
    getStatusText,
    getRulesText,
    getGame,
    handleQuickInput,
    parseQuickInput
  };
}

function resultToToolReply(toolName, result, successSummary) {
  return createToolResult({
    ok: true,
    name: toolName,
    result: result.ok ? result.text : result.error,
    summary: result.ok ? successSummary : 'number-guess validation message'
  });
}

function extractGuessInput(input = {}) {
  const sources = [input.guess, input.query, input.raw, input.text];
  for (const item of sources) {
    const guess = parseGuessText(item);
    if (guess) return guess;
  }
  return '';
}

function createStartTool(service) {
  return {
    name: 'games.number-guess.start',
    description: '开始一局猜数字。示例：猜数字、猜数字 困难。位数由难度固定决定。',
    aliases: ['猜数字', '数字游戏', 'ab游戏'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' },
        difficulty: { type: 'string' },
        digits: { type: 'number' },
        maxAttempts: { type: 'number' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['猜数字', '数字游戏', 'ab游戏']
    },
    async execute(context = {}, input = {}) {
      const result = service.startGame(context.session, input);
      return resultToToolReply('games.number-guess.start', result, 'number guess opened');
    }
  };
}

function createGuessTool(service) {
  return {
    name: 'games.number-guess.guess',
    description: '提交一次猜测，示例：猜 1234。',
    aliases: ['猜数字猜', '猜数字提交'],
    inputSchema: {
      type: 'object',
      properties: {
        guess: { type: 'string' },
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    async execute(context = {}, input = {}) {
      const guess = extractGuessInput(input);
      const result = service.applyGuess(context.session, guess, {
        quoteMessageId: getSessionQuoteMessageId(context.session)
      });
      return resultToToolReply('games.number-guess.guess', result, 'number guess guessed');
    }
  };
}

function createStatusTool(service) {
  return {
    name: 'games.number-guess.status',
    description: '查看当前房间猜数字状态。',
    aliases: ['猜数字状态', '猜数字进度'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['猜数字状态', '猜数字进度']
    },
    async execute(context = {}) {
      const result = service.getStatusText(context.session);
      return createToolResult({
        ok: true,
        name: 'games.number-guess.status',
        result: result.text,
        summary: 'number guess status'
      });
    }
  };
}

function createRulesTool(service) {
  return {
    name: 'games.number-guess.rules',
    description: '查看猜数字玩法规则。',
    aliases: ['猜数字规则', '数字游戏规则', 'ab游戏规则'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['猜数字 规则', '猜数字规则', '数字游戏 规则', 'ab游戏 规则']
    },
    async execute() {
      return createToolResult({
        ok: true,
        name: 'games.number-guess.rules',
        result: service.getRulesText(),
        summary: 'number guess rules'
      });
    }
  };
}

function createModeTool(service) {
  return {
    name: 'games.number-guess.mode',
    description: '查看或切换猜数字是否允许重复数字。示例：猜数字 模式、猜数字 模式 不重复。',
    aliases: ['猜数字模式', '猜数字设置'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' },
        mode: { type: 'string' },
        args: { type: 'string' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['猜数字 模式', '猜数字模式', '猜数字 设置']
    },
    async execute(context = {}, input = {}) {
      const result = service.setMode(context.session, input);
      return resultToToolReply('games.number-guess.mode', result, 'number guess mode updated');
    }
  };
}

function createRestartTool(service) {
  return {
    name: 'games.number-guess.restart',
    description: '重开当前房间猜数字对局。',
    aliases: ['重开猜数字', '重新开始猜数字'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' },
        difficulty: { type: 'string' },
        digits: { type: 'number' },
        maxAttempts: { type: 'number' }
      }
    },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['重开猜数字', '重新开始猜数字']
    },
    async execute(context = {}, input = {}) {
      const result = service.restartGame(context.session, input);
      return resultToToolReply('games.number-guess.restart', result, 'number guess restarted');
    }
  };
}

function createQuitTool(service) {
  return {
    name: 'games.number-guess.quit',
    description: '结束当前房间猜数字对局。',
    aliases: ['结束猜数字', '退出猜数字'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['结束猜数字', '退出猜数字']
    },
    async execute(context = {}) {
      const result = service.quitGame(context.session);
      return resultToToolReply('games.number-guess.quit', result, 'number guess quit');
    }
  };
}

function createExtendTool(service) {
  return {
    name: 'games.number-guess.extend',
    description: '失败后延长续命十次，继续当前猜数字对局。',
    aliases: ['延长续命十次', '续命十次', '猜数字续命'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['延长续命十次', '续命十次', '猜数字 续命']
    },
    async execute(context = {}) {
      const result = service.extendLife(context.session);
      return resultToToolReply('games.number-guess.extend', result, 'number guess extended');
    }
  };
}

async function sendReply(pluginContext, session, text, options = {}) {
  if (!pluginContext.outputRuntime || !session || !text) return;
  await pluginContext.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text,
      useMemePipeline: false
    },
    metadata: {
      ...(options.quoteMessageId ? { quoteMessageId: options.quoteMessageId } : {})
    }
  }, buildExecutionContext({ session }, pluginContext));
}

function logInfo(logger, message) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`[games.number-guess] ${message}`);
  }
}

module.exports = {
  name: 'games-number-guess',
  createNumberGuessService,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const service = createNumberGuessService({
      ...pluginConfig,
      logger: context.logger || host.logger || console
    });

    host.registerService('games.number-guess', service);

    const cleanup = context.ctx?.on?.('message', async (session) => {
      try {
        const userId = getSessionUserId(session);
        const botId = normalizeText(context.config?.bot?.uid, 80);
        if (!userId || (botId && userId === botId)) return;

        const result = service.handleQuickInput(session);
        if (!result) return;

        const quoteMessageId = service.config.quoteReply ? getSessionMessageId(session) : '';
        await sendReply(
          context,
          session,
          result.ok ? result.text : result.error,
          { quoteMessageId }
        );
      } catch (error) {
        logInfo(context.logger || host.logger || console, `quick input failed: ${error.message}`);
      }
    });
    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    context.registerToolPackage({
      name: 'games-number-guess-package',
      version: '0.1.0',
      tools: [
        createStartTool(service),
        createModeTool(service),
        createGuessTool(service),
        createStatusTool(service),
        createRulesTool(service),
        createRestartTool(service),
        createExtendTool(service),
        createQuitTool(service)
      ],
      metadata: {
        pluginName: 'games-number-guess',
        description: '多人猜数字（AB 反馈）'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'games.number-guess.start',
              'games.number-guess.mode',
              'games.number-guess.guess',
              'games.number-guess.status',
              'games.number-guess.rules',
              'games.number-guess.restart',
              'games.number-guess.extend',
              'games.number-guess.quit'
            ]
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'games.number-guess.start',
              'games.number-guess.mode',
              'games.number-guess.guess',
              'games.number-guess.status',
              'games.number-guess.rules',
              'games.number-guess.restart',
              'games.number-guess.extend',
              'games.number-guess.quit'
            ]
          }
        }
      ]
    });
  }
};
