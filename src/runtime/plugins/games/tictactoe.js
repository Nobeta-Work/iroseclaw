/**
 * Builtin plugin: tictactoe
 * 准交互井字棋：显式命令开局，活跃对局中接管纯数字消息。
 * 支持单人（对 bot）和双人模式。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const {
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId
} = require('../../../utils/session-metadata');

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  dataDir: path.join(process.cwd(), 'data', 'games-tictactoe'),
  stateFile: 'games.json',
  oneGamePerRoom: true,
  allowPrivate: true,
  includeRooms: [],
  excludeRooms: [],
  autoCleanupMs: 30 * 60 * 1000,
  maxQuickInputChars: 8,
  acceptBareDigit: true,
  restartKeywords: ['重开', '重新开始', '再来一局'],
  quitKeywords: ['退出', '结束', '结束井字棋'],
  statusKeywords: ['状态', '棋盘', '查看棋盘'],
  joinKeywords: ['加入', '加入井字棋', '应战', '接受挑战'],
  duoKeywords: ['双人', '双人模式', '多人', '对战', 'pvp'],
  soloKeywords: ['单人', '人机', '和你下'],
  playerMark: 'X',
  botMark: 'O',
  botName: '我',
  botUid: 'bot',
  renderStyle: 'ascii'
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

const PREFERRED_AI_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.floor(num));
}

function normalizeText(value, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => normalizeText(item, 120))
      .filter(Boolean)
  )];
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

function createEmptyBoard() {
  return Array.from({ length: 9 }, () => '');
}

function isBoardFull(board = []) {
  return board.every(cell => cell === 'X' || cell === 'O');
}

function getWinner(board = []) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return '';
}

function getAvailableMoves(board = []) {
  const moves = [];
  for (const index of PREFERRED_AI_ORDER) {
    if (!board[index]) moves.push(index);
  }
  return moves;
}

function scoreBoard(board, xMark, oMark, botMark, depth) {
  const winner = getWinner(board);
  if (winner === botMark) return 10 - depth;
  if (winner === (botMark === xMark ? oMark : xMark)) return depth - 10;
  if (isBoardFull(board)) return 0;
  return null;
}

function minimax(board, isBotTurn, xMark, oMark, botMark, depth = 0) {
  const scored = scoreBoard(board, xMark, oMark, botMark, depth);
  if (scored !== null) {
    return {
      score: scored,
      move: -1
    };
  }

  const availableMoves = getAvailableMoves(board);
  let best = {
    score: isBotTurn ? -Infinity : Infinity,
    move: availableMoves[0] ?? -1
  };

  for (const move of availableMoves) {
    board[move] = isBotTurn ? botMark : (botMark === xMark ? oMark : xMark);
    const result = minimax(board, !isBotTurn, xMark, oMark, botMark, depth + 1);
    board[move] = '';

    if (isBotTurn) {
      if (result.score > best.score) {
        best = { score: result.score, move };
      }
    } else if (result.score < best.score) {
      best = { score: result.score, move };
    }
  }

  return best;
}

function defaultChooseAiMove(state) {
  const board = [...state.board];
  const result = minimax(board, true, 'X', 'O', state.botMark || 'O', 0);
  return Number.isInteger(result.move) && result.move >= 0 ? result.move : -1;
}

function renderCell(board, index) {
  const value = board[index];
  return value || String(index + 1);
}

function renderBoardAscii(state) {
  const board = state.board || createEmptyBoard();
  return [
    ` ${renderCell(board, 0)} | ${renderCell(board, 1)} | ${renderCell(board, 2)}`,
    '---+---+---',
    ` ${renderCell(board, 3)} | ${renderCell(board, 4)} | ${renderCell(board, 5)}`,
    '---+---+---',
    ` ${renderCell(board, 6)} | ${renderCell(board, 7)} | ${renderCell(board, 8)}`
  ].join('\n');
}

function renderBoard(state, options = {}) {
  const renderImpl = typeof options.renderBoard === 'function'
    ? options.renderBoard
    : renderBoardAscii;
  return renderImpl(state, options);
}

function normalizeEpochTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return Date.now();
  return num >= 1e9 && num < 1e12 ? num * 1000 : num;
}

function isPrivateChannel(channelId = '') {
  return String(channelId || '').startsWith('private:');
}

function getOtherMark(mark) {
  return mark === 'X' ? 'O' : 'X';
}

function createParticipant(id, name, mark, isBot = false) {
  return {
    id,
    name,
    mark,
    isBot
  };
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

function createGameState(session, config, mode = 'solo') {
  const userId = getSessionUserId(session);
  const username = getSessionUsername(session) || '玩家';
  const channelId = getSessionChannelId(session) || '';
  const now = Date.now();

  return {
    channelId,
    mode,
    hostId: userId,
    hostName: username,
    players: {
      X: createParticipant(userId, username, 'X', false),
      O: mode === 'solo'
        ? createParticipant(config.botUid || DEFAULT_CONFIG.botUid, config.botName || DEFAULT_CONFIG.botName, 'O', true)
        : null
    },
    board: createEmptyBoard(),
    playerMark: config.playerMark || DEFAULT_CONFIG.playerMark,
    botMark: config.botMark || DEFAULT_CONFIG.botMark,
    currentTurn: mode === 'solo' ? 'X' : 'X',
    status: mode === 'solo' ? 'playing' : 'waiting',
    moveCount: 0,
    lastMoveIndex: -1,
    lastMoveMark: '',
    quitBy: '',
    createdAt: now,
    updatedAt: now
  };
}

function extractMoveNumber(input = {}) {
  const sources = [input.move, input.position, input.query, input.raw];
  for (const source of sources) {
    const text = normalizeText(source, 40);
    if (!text) continue;
    const match = text.match(/[1-9]/);
    if (match?.[0]) {
      return Number(match[0]);
    }
  }
  return 0;
}

function detectMode(input = {}, config = {}) {
  const text = normalizeText(
    [input.mode, input.query, input.raw].filter(Boolean).join(' '),
    120
  );
  if (!text) return 'solo';

  const duoKeywords = config.duoKeywords || DEFAULT_CONFIG.duoKeywords;
  const soloKeywords = config.soloKeywords || DEFAULT_CONFIG.soloKeywords;

  if (duoKeywords.some(keyword => text.includes(keyword))) {
    return 'duo';
  }
  if (soloKeywords.some(keyword => text.includes(keyword))) {
    return 'solo';
  }
  return 'solo';
}

function buildExecutionContext(context, pluginContext) {
  return {
    session: context.session,
    ctx: pluginContext.ctx,
    userId: getSessionUserId(context.session),
    username: getSessionUsername(context.session),
    contextService: pluginContext.contextService,
    conversationStore: pluginContext.contextService,
    sendOptions: {
      conversationStore: pluginContext.contextService,
      botProfile: pluginContext.config?.bot || {}
    }
  };
}

function logInfo(logger, message) {
  if (logger && typeof logger.INFO === 'function') {
    logger.INFO('TICTACTOE', message);
    return;
  }
  logger?.info?.(message);
}

function getParticipantByMark(state, mark) {
  return state?.players?.[mark] || null;
}

function getParticipantMark(state, userId) {
  if (!state?.players || !userId) return '';
  if (state.players.X?.id === userId) return 'X';
  if (state.players.O?.id === userId) return 'O';
  return '';
}

function getParticipantName(state, mark, fallback = '玩家') {
  return getParticipantByMark(state, mark)?.name || fallback;
}

function isParticipant(state, userId) {
  return Boolean(getParticipantMark(state, userId));
}

function isSpectatorStatusAllowed(state, userId) {
  if (!state) return false;
  if (!userId) return false;
  return isParticipant(state, userId) || state.hostId === userId;
}

function getWinStatusFromMark(mark) {
  return mark === 'X' ? 'x_won' : 'o_won';
}

function formatStatusLine(state) {
  if (state.status === 'waiting') {
    return '等待第二位玩家加入。直接发送「加入」或「加入井字棋」即可应战。';
  }
  if (state.status === 'x_won' || state.status === 'o_won') {
    const winnerMark = state.status === 'x_won' ? 'X' : 'O';
    return `${getParticipantName(state, winnerMark)} 赢了。发送「重开」可再来一局。`;
  }
  if (state.status === 'draw') {
    return '平局。发送「重开」可再来一局。';
  }
  if (state.status === 'quit') {
    return state.quitBy ? `${state.quitBy} 已退出，对局结束。` : '对局已结束。';
  }
  const turnMark = state.currentTurn || 'X';
  return `轮到 ${getParticipantName(state, turnMark)}（${turnMark}），直接发送数字 1-9 落子。`;
}

function formatPlayersLine(state, options = {}) {
  const xName = getParticipantName(state, 'X');
  const oName = state.players.O
    ? getParticipantName(state, 'O')
    : '等待加入';

  if (state.mode === 'solo') {
    return `你是 ${state.playerMark}，${options.botName || DEFAULT_CONFIG.botName}是 ${state.botMark}`;
  }

  return `X: ${xName}\nO: ${oName}`;
}

function formatLastMoveLine(state, options = {}) {
  if (state.lastMoveIndex < 0 || !state.lastMoveMark) return '';
  const mark = state.lastMoveMark;
  const name = getParticipantName(state, mark, options.botName || DEFAULT_CONFIG.botName);
  return `最近一步：${name}（${mark}） 下在 ${state.lastMoveIndex + 1}`;
}

function formatControlsLine(state) {
  if (state.status === 'waiting') {
    return '发送「加入 / 状态 / 退出」可继续。';
  }
  if (state.status === 'playing') {
    return '发送「状态 / 重开 / 退出」可管理对局。';
  }
  return '发送「重开」开始下一局，或发送「退出」清理本局。';
}

function formatGameText(state, options = {}) {
  const title = state.mode === 'duo' ? '井字棋（双人）' : '井字棋';
  const lines = [
    title,
    '',
    renderBoard(state, options),
    '',
    formatPlayersLine(state, options),
    formatStatusLine(state),
    formatControlsLine(state)
  ];

  const lastMoveLine = formatLastMoveLine(state, options);
  if (lastMoveLine) {
    lines.push(lastMoveLine);
  }

  return lines.join('\n');
}

function createTicTacToeService(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    includeRooms: normalizeStringArray(options.includeRooms),
    excludeRooms: normalizeStringArray(options.excludeRooms),
    restartKeywords: normalizeStringArray(options.restartKeywords).length > 0
      ? normalizeStringArray(options.restartKeywords)
      : DEFAULT_CONFIG.restartKeywords,
    quitKeywords: normalizeStringArray(options.quitKeywords).length > 0
      ? normalizeStringArray(options.quitKeywords)
      : DEFAULT_CONFIG.quitKeywords,
    statusKeywords: normalizeStringArray(options.statusKeywords).length > 0
      ? normalizeStringArray(options.statusKeywords)
      : DEFAULT_CONFIG.statusKeywords,
    joinKeywords: normalizeStringArray(options.joinKeywords).length > 0
      ? normalizeStringArray(options.joinKeywords)
      : DEFAULT_CONFIG.joinKeywords,
    duoKeywords: normalizeStringArray(options.duoKeywords).length > 0
      ? normalizeStringArray(options.duoKeywords)
      : DEFAULT_CONFIG.duoKeywords,
    soloKeywords: normalizeStringArray(options.soloKeywords).length > 0
      ? normalizeStringArray(options.soloKeywords)
      : DEFAULT_CONFIG.soloKeywords,
    autoCleanupMs: toPositiveInt(options.autoCleanupMs, DEFAULT_CONFIG.autoCleanupMs),
    maxQuickInputChars: toPositiveInt(options.maxQuickInputChars, DEFAULT_CONFIG.maxQuickInputChars)
  };
  const store = options.store || createGameStore(config);
  const renderBoardImpl = typeof options.renderBoard === 'function' ? options.renderBoard : null;
  const chooseAiMove = typeof options.chooseAiMove === 'function' ? options.chooseAiMove : defaultChooseAiMove;
  const logger = options.logger || console;

  function isChannelEnabled(channelId) {
    if (!channelId) return false;
    if (config.allowPrivate !== true && isPrivateChannel(channelId)) return false;
    if (config.includeRooms.length > 0 && !config.includeRooms.includes(channelId)) return false;
    if (config.excludeRooms.includes(channelId)) return false;
    return true;
  }

  function resolveGameKey(session) {
    const channelId = getSessionChannelId(session);
    const userId = getSessionUserId(session);
    if (config.oneGamePerRoom !== false) {
      return `room:${channelId}`;
    }
    return `room:${channelId}:user:${userId}`;
  }

  function getGame(session) {
    const key = resolveGameKey(session);
    return key ? store.get(key) : null;
  }

  function saveGame(session, state) {
    const key = resolveGameKey(session);
    if (!key) return null;
    return store.set(key, {
      ...state,
      updatedAt: Date.now()
    });
  }

  function deleteGame(session) {
    const key = resolveGameKey(session);
    if (!key) return;
    store.delete(key);
  }

  function createBoardText(state) {
    return formatGameText(state, {
      botName: config.botName,
      renderBoard: renderBoardImpl
    });
  }

  function canStartNewGame(session, current) {
    const userId = getSessionUserId(session);
    if (!current) return { ok: true };
    if (current.status !== 'waiting' && current.status !== 'playing') {
      return { ok: true };
    }
    if (current.hostId === userId) {
      return {
        ok: false,
        error: '当前房间已有你发起的井字棋对局，请先继续、重开或退出。'
      };
    }
    return {
      ok: false,
      error: `当前房间已有 ${current.hostName} 发起的井字棋对局，暂不支持插队。`
    };
  }

  function startGame(session, mode = 'solo') {
    const channelId = getSessionChannelId(session);
    if (!isChannelEnabled(channelId)) {
      return {
        ok: false,
        error: '当前房间未启用井字棋插件。'
      };
    }

    const current = getGame(session);
    const availability = canStartNewGame(session, current);
    if (!availability.ok) {
      if (current && current.hostId === getSessionUserId(session)) {
        return {
          ok: true,
          state: current,
          text: createBoardText(current)
        };
      }
      return availability;
    }

    const next = createGameState(session, config, mode);
    saveGame(session, next);
    logInfo(logger, `started ${mode} game in ${channelId} for ${next.hostName}`);
    return {
      ok: true,
      state: next,
      text: createBoardText(next)
    };
  }

  function joinGame(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const username = getSessionUsername(session) || '玩家';

    if (!current) {
      return {
        ok: false,
        error: '当前没有可加入的井字棋对局。'
      };
    }
    if (current.mode !== 'duo') {
      return {
        ok: false,
        error: '当前这局井字棋是单人模式，无法加入。'
      };
    }
    if (current.status !== 'waiting') {
      return {
        ok: false,
        error: '当前双人井字棋已经开始了。'
      };
    }
    if (current.hostId === userId) {
      return {
        ok: false,
        error: '你已经是这局井字棋的发起者了。'
      };
    }
    if (isParticipant(current, userId)) {
      return {
        ok: true,
        state: current,
        text: createBoardText(current)
      };
    }

    const next = clone(current);
    next.players.O = createParticipant(userId, username, 'O', false);
    next.status = 'playing';
    next.currentTurn = 'X';
    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: createBoardText(next)
    };
  }

  function finalizeMove(next, mark) {
    const winner = getWinner(next.board);
    if (winner) {
      next.status = getWinStatusFromMark(winner);
      next.currentTurn = '';
      return next;
    }

    if (isBoardFull(next.board)) {
      next.status = 'draw';
      next.currentTurn = '';
      return next;
    }

    next.currentTurn = getOtherMark(mark);
    return next;
  }

  function applyAiTurn(state) {
    if (state.mode !== 'solo' || state.status !== 'playing' || state.currentTurn !== 'O') {
      return state;
    }

    const move = chooseAiMove(state, {
      getWinner,
      getAvailableMoves
    });
    if (!Number.isInteger(move) || move < 0 || move > 8 || state.board[move]) {
      return state;
    }

    state.board[move] = 'O';
    state.moveCount += 1;
    state.lastMoveIndex = move;
    state.lastMoveMark = 'O';
    finalizeMove(state, 'O');
    return state;
  }

  function applyPlayerMove(session, moveNumber) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const playerMark = getParticipantMark(current, userId);

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的井字棋。发送“@Bot 井字棋”开始。'
      };
    }

    if (!playerMark) {
      return {
        ok: false,
        error: '当前这局井字棋不属于你。'
      };
    }

    if (current.status === 'waiting') {
      return {
        ok: false,
        error: '当前双人井字棋还在等待第二位玩家加入。'
      };
    }

    if (current.status !== 'playing') {
      return {
        ok: false,
        error: '当前对局已结束。发送“重开”或“退出”继续。'
      };
    }

    if (current.currentTurn !== playerMark) {
      return {
        ok: false,
        error: `还没轮到你。当前轮到 ${getParticipantName(current, current.currentTurn)}（${current.currentTurn}）。`
      };
    }

    const index = Number(moveNumber) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 8) {
      return {
        ok: false,
        error: '请发送 1-9 之间的数字。'
      };
    }

    if (current.board[index]) {
      return {
        ok: false,
        error: `位置 ${moveNumber} 已经被占了。`
      };
    }

    const next = clone(current);
    next.board[index] = playerMark;
    next.moveCount += 1;
    next.lastMoveIndex = index;
    next.lastMoveMark = playerMark;
    finalizeMove(next, playerMark);

    if (next.mode === 'solo' && next.status === 'playing' && next.currentTurn === 'O') {
      applyAiTurn(next);
    }

    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: createBoardText(next)
    };
  }

  function restartGame(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);

    if (!current) {
      return {
        ok: false,
        error: '当前没有可重开的井字棋。'
      };
    }

    if (!isParticipant(current, userId) && current.hostId !== userId) {
      return {
        ok: false,
        error: `当前这局井字棋属于 ${current.hostName}。`
      };
    }

    const next = {
      ...clone(current),
      board: createEmptyBoard(),
      moveCount: 0,
      lastMoveIndex: -1,
      lastMoveMark: '',
      quitBy: '',
      updatedAt: Date.now(),
      status: current.mode === 'duo' && !current.players.O ? 'waiting' : 'playing',
      currentTurn: 'X'
    };

    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: createBoardText(next)
    };
  }

  function quitGame(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const username = getSessionUsername(session) || '玩家';

    if (!current) {
      return {
        ok: true,
        text: '当前没有进行中的井字棋。'
      };
    }

    if (!isParticipant(current, userId) && current.hostId !== userId) {
      return {
        ok: false,
        error: `当前这局井字棋属于 ${current.hostName}。`
      };
    }

    deleteGame(session);
    return {
      ok: true,
      text: current.mode === 'duo'
        ? `${username} 已退出，井字棋对局已结束。`
        : '井字棋对局已结束。'
    };
  }

  function getStatusText(session) {
    const current = getGame(session);
    if (!current) {
      return {
        ok: true,
        text: '当前没有进行中的井字棋。发送“@Bot 井字棋”开始。'
      };
    }
    return {
      ok: true,
      text: createBoardText(current),
      state: current
    };
  }

  function getRulesText() {
    return [
      '井字棋规则',
      '1) 棋盘为 3x3，X 先手，先连成一条线（横/竖/斜）者获胜。',
      '2) 单人模式：你执 X，机器人执 O。',
      '3) 双人模式：发起者为 X，第二位玩家加入后执 O。',
      '4) 游戏中可直接发送 1-9 落子，对应九宫格位置。',
      '5) 位置编号映射：1-2-3 / 4-5-6 / 7-8-9。',
      '6) 支持操作：加入（双人等待时）、状态、重开、退出。',
      '常用命令: 井字棋、井字棋 双人、加入、状态、重开、退出'
    ].join('\n');
  }

  function parseQuickInput(session) {
    const current = getGame(session);
    if (!current) return null;

    const rawText = normalizeText(session?.content, 80);
    const userId = getSessionUserId(session);
    const playerMark = getParticipantMark(current, userId);
    const isHost = current.hostId === userId;

    if (!rawText || rawText.length > config.maxQuickInputChars) return null;
    if (/<at\b|id="/i.test(rawText)) return null;

    if (current.mode === 'duo' && current.status === 'waiting') {
      if (!playerMark && config.joinKeywords.includes(rawText)) {
        return { type: 'join' };
      }
      if ((playerMark || isHost) && config.statusKeywords.includes(rawText)) {
        return { type: 'status' };
      }
      if ((playerMark || isHost) && config.restartKeywords.includes(rawText)) {
        return { type: 'restart' };
      }
      if ((playerMark || isHost) && config.quitKeywords.includes(rawText)) {
        return { type: 'quit' };
      }
      return null;
    }

    if (!playerMark) return null;
    if (!config.acceptBareDigit && /^[1-9]$/.test(rawText)) return null;

    if (/^[1-9]$/.test(rawText)) {
      return {
        type: 'move',
        value: Number(rawText)
      };
    }

    if (config.restartKeywords.includes(rawText)) {
      return { type: 'restart' };
    }
    if (config.quitKeywords.includes(rawText)) {
      return { type: 'quit' };
    }
    if (config.statusKeywords.includes(rawText)) {
      return { type: 'status' };
    }

    return null;
  }

  function handleQuickInput(session) {
    const parsed = parseQuickInput(session);
    if (!parsed) return null;
    if (parsed.type === 'move') {
      return applyPlayerMove(session, parsed.value);
    }
    if (parsed.type === 'join') {
      return joinGame(session);
    }
    if (parsed.type === 'restart') {
      return restartGame(session);
    }
    if (parsed.type === 'quit') {
      return quitGame(session);
    }
    return getStatusText(session);
  }

  return {
    config: { ...config },
    startGame,
    joinGame,
    applyPlayerMove,
    restartGame,
    quitGame,
    getStatusText,
    getRulesText,
    getGame,
    handleQuickInput,
    parseQuickInput,
    createBoardText
  };
}

function resultToToolReply(toolName, result, successSummary) {
  return createToolResult({
    ok: true,
    name: toolName,
    result: result.ok ? result.text : result.error,
    summary: result.ok ? successSummary : 'tictactoe validation message'
  });
}

function createStartTool(service) {
  return {
    name: 'games.tictactoe.start',
    description: '开始一局井字棋；支持单人和双人模式。示例：井字棋、井字棋 双人、双人井字棋。',
    aliases: ['井字棋', '井井棋', 'ttt', '双人井字棋', '多人井字棋'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['井字棋', '双人井字棋', '多人井字棋']
    },
    async execute(context = {}, input = {}) {
      const mode = detectMode(input, service.config);
      const opened = service.startGame(context.session, mode);
      if (!opened.ok) {
        return createToolResult({
          ok: true,
          name: 'games.tictactoe.start',
          result: opened.error,
          summary: 'tictactoe validation message'
        });
      }

      const moveNumber = mode === 'solo' ? extractMoveNumber(input) : 0;
      const result = moveNumber
        ? service.applyPlayerMove(context.session, moveNumber)
        : opened;

      return resultToToolReply('games.tictactoe.start', result, 'tictactoe opened');
    }
  };
}

function createJoinTool(service) {
  return {
    name: 'games.tictactoe.join',
    description: '加入当前房间等待中的双人井字棋。',
    aliases: ['加入井字棋', '应战井字棋', '接受挑战'],
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
      directAliases: ['加入井字棋', '应战井字棋', '接受挑战']
    },
    async execute(context = {}) {
      const result = service.joinGame(context.session);
      return resultToToolReply('games.tictactoe.join', result, 'tictactoe joined');
    }
  };
}

function createStatusTool(service) {
  return {
    name: 'games.tictactoe.status',
    description: '查看当前房间井字棋状态。',
    aliases: ['井字棋状态', '棋盘状态'],
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
      directAliases: ['井字棋状态', '棋盘状态']
    },
    async execute(context = {}) {
      const result = service.getStatusText(context.session);
      return createToolResult({
        ok: true,
        name: 'games.tictactoe.status',
        result: result.text,
        summary: 'tictactoe status'
      });
    }
  };
}

function createRulesTool(service) {
  return {
    name: 'games.tictactoe.rules',
    description: '查看井字棋玩法规则。',
    aliases: ['井字棋规则', '井井棋规则', 'ttt规则'],
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
      directAliases: ['井字棋 规则', '井字棋规则', 'ttt 规则']
    },
    async execute() {
      return createToolResult({
        ok: true,
        name: 'games.tictactoe.rules',
        result: service.getRulesText(),
        summary: 'tictactoe rules'
      });
    }
  };
}

function createRestartTool(service) {
  return {
    name: 'games.tictactoe.restart',
    description: '重开当前房间的井字棋对局。',
    aliases: ['重开井字棋', '重新开始井字棋'],
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
      directAliases: ['重开井字棋', '重新开始井字棋']
    },
    async execute(context = {}) {
      const result = service.restartGame(context.session);
      return resultToToolReply('games.tictactoe.restart', result, 'tictactoe restarted');
    }
  };
}

function createQuitTool(service) {
  return {
    name: 'games.tictactoe.quit',
    description: '结束当前房间的井字棋对局。',
    aliases: ['结束井字棋', '退出井字棋'],
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
      directAliases: ['结束井字棋', '退出井字棋']
    },
    async execute(context = {}) {
      const result = service.quitGame(context.session);
      return resultToToolReply('games.tictactoe.quit', result, 'tictactoe quit');
    }
  };
}

async function sendReply(pluginContext, session, text) {
  if (!pluginContext.outputRuntime || !session || !text) return;
  await pluginContext.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text,
      useMemePipeline: false
    }
  }, buildExecutionContext({ session }, pluginContext));
}

module.exports = {
  name: 'games-tictactoe',
  createTicTacToeService,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const service = createTicTacToeService({
      ...pluginConfig,
      botUid: context.config?.bot?.uid || DEFAULT_CONFIG.botUid,
      botName: pluginConfig.botName || context.config?.bot?.name || DEFAULT_CONFIG.botName,
      logger: context.logger || host.logger || console
    });

    host.registerService('games.tictactoe', service);

    const cleanup = context.ctx?.on?.('message', async (session) => {
      try {
        const userId = getSessionUserId(session);
        const botId = normalizeText(context.config?.bot?.uid, 80);
        if (!userId || (botId && userId === botId)) return;

        const result = service.handleQuickInput(session);
        if (!result) return;

        await sendReply(context, session, result.ok ? result.text : result.error);
      } catch (error) {
        logInfo(context.logger || host.logger || console, `quick input failed: ${error.message}`);
      }
    });
    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    context.registerToolPackage({
      name: 'games-tictactoe-package',
      version: '0.2.0',
      tools: [
        createStartTool(service),
        createJoinTool(service),
        createStatusTool(service),
        createRulesTool(service),
        createRestartTool(service),
        createQuitTool(service)
      ],
      metadata: {
        pluginName: 'games-tictactoe',
        description: '无需 LLM 的准交互井字棋'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'games.tictactoe.start',
              'games.tictactoe.join',
              'games.tictactoe.status',
              'games.tictactoe.rules',
              'games.tictactoe.restart',
              'games.tictactoe.quit'
            ]
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'games.tictactoe.start',
              'games.tictactoe.join',
              'games.tictactoe.status',
              'games.tictactoe.rules',
              'games.tictactoe.restart',
              'games.tictactoe.quit'
            ]
          }
        }
      ]
    });
  }
};
