/**
 * Builtin plugin: gomoku
 * 准交互五子棋：显式命令开局，活跃对局中接管坐标消息。
 * 仅支持双人模式。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const {
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId
} = require('../../../utils/session-metadata');

const BOARD_SIZE = 13;
const ROW_LABELS = 'ABCDEFGHIJKLM'.split('');
const COLUMN_MIN = 1;
const COLUMN_MAX = 13;
const COLUMN_HEADER_NOTE = 'ps：10后面的是[11]、[12]、[13]';
const COLUMN_HEADER_TEXT = '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟1️⃣2️⃣3️⃣';
const FOOTER_NOTE = '注：手机端点击右下角/不适用夸克浏览器';
const MARK_BLACK = 'B';
const MARK_WHITE = 'W';
const STATUS_WAITING = 'waiting';
const STATUS_PLAYING = 'playing';
const STATUS_BLACK_WON = 'black_won';
const STATUS_WHITE_WON = 'white_won';
const STATUS_DRAW = 'draw';
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  dataDir: path.join(process.cwd(), 'data', 'games-gomoku'),
  stateFile: 'games.json',
  oneGamePerRoom: true,
  allowPrivate: true,
  includeRooms: [],
  excludeRooms: [],
  autoCleanupMs: 60 * 60 * 1000,
  maxQuickInputChars: 16,
  restartKeywords: ['重开', '重新开始', '再来一局'],
  quitKeywords: ['退出', '结束', '结束五子棋'],
  statusKeywords: ['状态', '棋盘', '查看棋盘'],
  joinKeywords: ['加入', '加入五子棋', '应战', '接受挑战'],
  undoKeywords: ['悔棋', '晦气'],
  approveUndoKeywords: ['同意'],
  botUid: 'bot',
  botName: '我'
};

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

function normalizeEpochTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return Date.now();
  return num >= 1e9 && num < 1e12 ? num * 1000 : num;
}

function resolveClockNow(config = {}) {
  if (typeof config.now === 'function') {
    const value = normalizeTimerTimestamp(config.now());
    if (value > 0) return value;
  }
  return Date.now();
}

function normalizeDurationMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.max(0, Math.floor(num));
}

function normalizeTimerTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num >= 1e9 && num < 1e12 ? num * 1000 : Math.floor(num);
}

function isPrivateChannel(channelId = '') {
  return String(channelId || '').startsWith('private:');
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => '');
}

function toBoardIndex(row, col) {
  return row * BOARD_SIZE + col;
}

function isInsideBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function getCell(board = [], row, col) {
  if (!isInsideBoard(row, col)) return '';
  return board[toBoardIndex(row, col)] || '';
}

function isBoardFull(board = []) {
  return board.every(cell => cell === MARK_BLACK || cell === MARK_WHITE);
}

function getOtherMark(mark) {
  return mark === MARK_BLACK ? MARK_WHITE : MARK_BLACK;
}

function getWinStatusFromMark(mark) {
  return mark === MARK_BLACK ? STATUS_BLACK_WON : STATUS_WHITE_WON;
}

function createParticipant(id, name, mark) {
  return {
    id,
    name,
    mark
  };
}

function createEmptyTimers() {
  return {
    [MARK_BLACK]: {
      totalMs: 0,
      lastMoveMs: 0
    },
    [MARK_WHITE]: {
      totalMs: 0,
      lastMoveMs: 0
    }
  };
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.floor(normalizeDurationMs(value) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCoordinate(row, col) {
  if (!isInsideBoard(row, col)) return '';
  return `${ROW_LABELS[row]}${col + COLUMN_MIN}`;
}

function parseCoordinateText(rawText = '') {
  const text = normalizeText(rawText, 32).replace(/\s+/g, '');
  if (!text) return null;

  const rowFirst = text.match(/^([a-m])(1[0-3]|[1-9])$/i);
  if (rowFirst) {
    const row = ROW_LABELS.indexOf(rowFirst[1].toUpperCase());
    const col = Number(rowFirst[2]) - COLUMN_MIN;
    if (isInsideBoard(row, col)) {
      return { row, col, coord: formatCoordinate(row, col) };
    }
    return null;
  }

  const colFirst = text.match(/^(1[0-3]|[1-9])([a-m])$/i);
  if (colFirst) {
    const col = Number(colFirst[1]) - COLUMN_MIN;
    const row = ROW_LABELS.indexOf(colFirst[2].toUpperCase());
    if (isInsideBoard(row, col)) {
      return { row, col, coord: formatCoordinate(row, col) };
    }
  }

  return null;
}

function createGameStore(config = {}) {
  const dataDir = path.resolve(config.dataDir || DEFAULT_CONFIG.dataDir);
  const filePath = path.resolve(dataDir, config.stateFile || DEFAULT_CONFIG.stateFile);
  let games = config.persist !== false ? readJsonFile(filePath, {}) : {};

  function cleanupExpired() {
    const now = resolveClockNow(config);
    const autoCleanupMs = toPositiveInt(config.autoCleanupMs, DEFAULT_CONFIG.autoCleanupMs);
    let changed = false;

    for (const [key, game] of Object.entries(games)) {
      const updatedAt = normalizeTimerTimestamp(game?.updatedAt);
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

function createGameState(session) {
  const userId = getSessionUserId(session);
  const username = getSessionUsername(session) || '玩家';
  const channelId = getSessionChannelId(session) || '';
  const now = Date.now();

  return {
    channelId,
    hostId: userId,
    hostName: username,
    players: {
      [MARK_BLACK]: createParticipant(userId, username, MARK_BLACK),
      [MARK_WHITE]: null
    },
    board: createEmptyBoard(),
    currentTurn: MARK_BLACK,
    turnStartedAt: 0,
    status: STATUS_WAITING,
    moveCount: 0,
    moveHistory: [],
    pendingUndo: null,
    timers: createEmptyTimers(),
    lastMoveRow: -1,
    lastMoveCol: -1,
    lastMoveMark: '',
    createdAt: now,
    updatedAt: now
  };
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
    logger.INFO('GOMOKU', message);
    return;
  }
  logger?.info?.(message);
}

function getParticipantByMark(state, mark) {
  return state?.players?.[mark] || null;
}

function getParticipantMark(state, userId) {
  if (!state?.players || !userId) return '';
  if (state.players[MARK_BLACK]?.id === userId) return MARK_BLACK;
  if (state.players[MARK_WHITE]?.id === userId) return MARK_WHITE;
  return '';
}

function getParticipantName(state, mark, fallback = '玩家') {
  return getParticipantByMark(state, mark)?.name || fallback;
}

function getTimerBucket(state, mark) {
  const timers = state?.timers && typeof state.timers === 'object'
    ? state.timers
    : createEmptyTimers();
  const bucket = timers[mark] && typeof timers[mark] === 'object'
    ? timers[mark]
    : {};

  return {
    totalMs: normalizeDurationMs(bucket.totalMs),
    lastMoveMs: normalizeDurationMs(bucket.lastMoveMs)
  };
}

function isParticipant(state, userId) {
  return Boolean(getParticipantMark(state, userId));
}

function getMarkLabel(mark) {
  return mark === MARK_BLACK ? '黑' : '白';
}

function getMarkLabelWithEmoji(mark) {
  return mark === MARK_BLACK ? '黑🟥' : '白🟪';
}

function renderCell(board, row, col) {
  const value = getCell(board, row, col);
  if (value === MARK_BLACK) return '🟥';
  if (value === MARK_WHITE) return '🟪';
  return '⬜';
}

function renderBoard(state) {
  const board = state.board || createEmptyBoard();
  const rows = [COLUMN_HEADER_NOTE, COLUMN_HEADER_TEXT];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let line = '';
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      line += renderCell(board, row, col);
    }
    line += ROW_LABELS[row];
    rows.push(line);
  }

  return rows.join('\n');
}

function formatStatusLine(state) {
  if (state.status === STATUS_WAITING) {
    return '等待第二位玩家加入。直接发送「加入」或「加入五子棋」即可应战。';
  }
  if (state.status === STATUS_BLACK_WON || state.status === STATUS_WHITE_WON) {
    const winnerMark = state.status === STATUS_BLACK_WON ? MARK_BLACK : MARK_WHITE;
    return `${getParticipantName(state, winnerMark)} 赢了。发送「重开」可再来一局。`;
  }
  if (state.status === STATUS_DRAW) {
    return '平局。发送「重开」可再来一局。';
  }

  const turnMark = state.currentTurn || MARK_BLACK;
  return `轮到 ${getParticipantName(state, turnMark)}（${getMarkLabelWithEmoji(turnMark)}），直接发送坐标如 D5 / 5D 落子。`;
}

function formatPlayersLine(state) {
  const blackName = getParticipantName(state, MARK_BLACK);
  const whiteName = state.players[MARK_WHITE]
    ? getParticipantName(state, MARK_WHITE)
    : '等待加入';

  return `黑: ${blackName}\n白: ${whiteName}`;
}

function formatPendingUndoLine(state) {
  const pendingUndo = state?.pendingUndo;
  if (!pendingUndo) return '';
  return `悔棋申请：${pendingUndo.requesterName}（${getMarkLabelWithEmoji(pendingUndo.requesterMark)}）请求撤销 ${pendingUndo.coord}，等待 ${pendingUndo.approverName} 发送「同意」。`;
}

function formatTimerSummaryLines(state) {
  return [
    `黑方用时：${formatDuration(getTimerBucket(state, MARK_BLACK).totalMs)}`,
    `白方用时：${formatDuration(getTimerBucket(state, MARK_WHITE).totalMs)}`
  ];
}

function getCurrentTurnElapsedMs(state, now) {
  if (state.status !== STATUS_PLAYING || state.pendingUndo || !state.currentTurn) return 0;
  const startedAt = normalizeTimerTimestamp(state.turnStartedAt);
  if (!startedAt || startedAt > now) return 0;
  return now - startedAt;
}

function formatCurrentTurnTimerLine(state, now) {
  if (state.status !== STATUS_PLAYING || state.pendingUndo || !state.currentTurn) return '';
  return `当前手计时：${getParticipantName(state, state.currentTurn)}（${getMarkLabelWithEmoji(state.currentTurn)}） ${formatDuration(getCurrentTurnElapsedMs(state, now))}`;
}

function formatLastMoveLine(state) {
  const lastMove = getLastHistoryMove(state);
  if (lastMove) {
    const name = getParticipantName(state, lastMove.mark, lastMove.username || '玩家');
    const duration = formatDuration(lastMove.thinkMs);
    return `最近一步：${name}（${getMarkLabelWithEmoji(lastMove.mark)}） 用时 ${duration}，下在 ${formatCoordinate(lastMove.row, lastMove.col)}`;
  }

  if (state.lastMoveRow < 0 || state.lastMoveCol < 0 || !state.lastMoveMark) return '';
  const name = getParticipantName(state, state.lastMoveMark);
  return `最近一步：${name}（${getMarkLabelWithEmoji(state.lastMoveMark)}） 下在 ${formatCoordinate(state.lastMoveRow, state.lastMoveCol)}`;
}

function formatControlsLine(state) {
  if (state.status === STATUS_WAITING) {
    return '发送「加入 / 状态 / 退出」可继续。';
  }
  if (state.pendingUndo) {
    return '发送「状态 / 同意 / 退出」可管理对局。';
  }
  if (state.status === STATUS_PLAYING) {
    return '发送「状态 / 悔棋 / 重开 / 退出」可管理对局。';
  }
  return '发送「悔棋 / 重开」开始复盘，或发送「退出」清理本局。';
}

function formatLegendLine() {
  return '黑棋🟥 白棋🟪 空位⬜';
}

function formatGameText(state, options = {}) {
  const now = normalizeTimerTimestamp(options.now) || Date.now();
  const lines = [
    '五子棋（双人）',
    '',
    renderBoard(state),
    '',
    formatPlayersLine(state),
    ...formatTimerSummaryLines(state),
    formatStatusLine(state),
    formatControlsLine(state)
  ];

  const lastMoveLine = formatLastMoveLine(state);
  if (lastMoveLine) {
    lines.push(lastMoveLine);
  }

  const currentTurnTimerLine = formatCurrentTurnTimerLine(state, now);
  if (currentTurnTimerLine) {
    lines.push(currentTurnTimerLine);
  }

  const pendingUndoLine = formatPendingUndoLine(state);
  if (pendingUndoLine) {
    lines.push(pendingUndoLine);
  }

  lines.push(formatLegendLine());
  lines.push(FOOTER_NOTE);
  return lines.join('\n');
}

function getLastHistoryMove(state) {
  const moveHistory = Array.isArray(state?.moveHistory) ? state.moveHistory : [];
  return moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
}

function syncLastMoveFromHistory(state) {
  const lastMove = getLastHistoryMove(state);
  if (!lastMove) {
    state.lastMoveRow = -1;
    state.lastMoveCol = -1;
    state.lastMoveMark = '';
    return state;
  }

  state.lastMoveRow = lastMove.row;
  state.lastMoveCol = lastMove.col;
  state.lastMoveMark = lastMove.mark;
  return state;
}

function getLastMoveDurationForMark(state, mark) {
  const moveHistory = Array.isArray(state?.moveHistory) ? state.moveHistory : [];
  for (let index = moveHistory.length - 1; index >= 0; index -= 1) {
    const move = moveHistory[index];
    if (move?.mark === mark) {
      return normalizeDurationMs(move.thinkMs);
    }
  }
  return 0;
}

function ensureStateDefaults(state, now = Date.now()) {
  if (!state || typeof state !== 'object') return state;

  state.moveHistory = Array.isArray(state.moveHistory)
    ? state.moveHistory.map(item => ({
      ...item,
      row: Number.isInteger(item?.row) ? item.row : -1,
      col: Number.isInteger(item?.col) ? item.col : -1,
      mark: item?.mark === MARK_WHITE ? MARK_WHITE : MARK_BLACK,
      startedAt: normalizeTimerTimestamp(item?.startedAt),
      playedAt: normalizeTimerTimestamp(item?.playedAt),
      thinkMs: normalizeDurationMs(item?.thinkMs)
    }))
    : [];
  state.pendingUndo = state.pendingUndo && typeof state.pendingUndo === 'object'
    ? { ...state.pendingUndo }
    : null;

  const timers = createEmptyTimers();
  timers[MARK_BLACK] = getTimerBucket({ timers: state.timers }, MARK_BLACK);
  timers[MARK_WHITE] = getTimerBucket({ timers: state.timers }, MARK_WHITE);
  state.timers = timers;

  state.turnStartedAt = normalizeTimerTimestamp(state.turnStartedAt);
  if (state.status === STATUS_PLAYING && !state.pendingUndo && !state.turnStartedAt) {
    state.turnStartedAt = normalizeTimerTimestamp(now) || Date.now();
  }
  if (state.pendingUndo) {
    state.turnStartedAt = 0;
  }

  syncLastMoveFromHistory(state);
  state.timers[MARK_BLACK].lastMoveMs = getLastMoveDurationForMark(state, MARK_BLACK);
  state.timers[MARK_WHITE].lastMoveMs = getLastMoveDurationForMark(state, MARK_WHITE);
  return state;
}

function countInDirection(board, row, col, rowStep, colStep, mark) {
  let total = 0;
  let nextRow = row + rowStep;
  let nextCol = col + colStep;

  while (isInsideBoard(nextRow, nextCol) && getCell(board, nextRow, nextCol) === mark) {
    total += 1;
    nextRow += rowStep;
    nextCol += colStep;
  }

  return total;
}

function isWinningMove(board, row, col, mark) {
  for (const [rowStep, colStep] of DIRECTIONS) {
    const count = 1
      + countInDirection(board, row, col, rowStep, colStep, mark)
      + countInDirection(board, row, col, -rowStep, -colStep, mark);
    if (count >= 5) {
      return true;
    }
  }
  return false;
}

function createGomokuService(options = {}) {
  const nowProvider = typeof options.now === 'function' ? options.now : () => Date.now();
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
    undoKeywords: normalizeStringArray(options.undoKeywords).length > 0
      ? normalizeStringArray(options.undoKeywords)
      : DEFAULT_CONFIG.undoKeywords,
    approveUndoKeywords: normalizeStringArray(options.approveUndoKeywords).length > 0
      ? normalizeStringArray(options.approveUndoKeywords)
      : DEFAULT_CONFIG.approveUndoKeywords,
    autoCleanupMs: toPositiveInt(options.autoCleanupMs, DEFAULT_CONFIG.autoCleanupMs),
    maxQuickInputChars: toPositiveInt(options.maxQuickInputChars, DEFAULT_CONFIG.maxQuickInputChars)
  };
  const store = options.store || createGameStore(config);
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
    const game = key ? store.get(key) : null;
    return game ? ensureStateDefaults(game, nowProvider()) : null;
  }

  function saveGame(session, state) {
    const key = resolveGameKey(session);
    if (!key) return null;
    return store.set(key, ensureStateDefaults({
      ...state,
      updatedAt: nowProvider()
    }, nowProvider()));
  }

  function deleteGame(session) {
    const key = resolveGameKey(session);
    if (!key) return;
    store.delete(key);
  }

  function createBoardText(state) {
    return formatGameText(state, {
      now: nowProvider()
    });
  }

  function buildPrefixedBoardText(prefix, state) {
    const title = normalizeText(prefix, 240);
    if (!title) return createBoardText(state);
    return `${title}\n\n${createBoardText(state)}`;
  }

  function clearUndoState(state) {
    state.pendingUndo = null;
    return state;
  }

  function createUndoRequest(state, requesterMark) {
    const requester = getParticipantByMark(state, requesterMark);
    const approverMark = getOtherMark(requesterMark);
    const approver = getParticipantByMark(state, approverMark);
    const move = getLastHistoryMove(state);
    if (!requester || !approver || !move) return null;

    return {
      requesterId: requester.id,
      requesterName: requester.name,
      requesterMark,
      approverId: approver.id,
      approverName: approver.name,
      approverMark,
      row: move.row,
      col: move.col,
      coord: formatCoordinate(move.row, move.col),
      requestedAt: Date.now()
    };
  }

  function canStartNewGame(session, current) {
    const userId = getSessionUserId(session);
    if (!current) return { ok: true };
    if (current.status !== STATUS_WAITING && current.status !== STATUS_PLAYING) {
      return { ok: true };
    }
    if (current.hostId === userId) {
      return {
        ok: false,
        error: '当前房间已有你发起的五子棋对局，请先继续、重开或退出。'
      };
    }
    return {
      ok: false,
      error: `当前房间已有 ${current.hostName} 发起的五子棋对局，暂不支持插队。`
    };
  }

  function startGame(session) {
    const channelId = getSessionChannelId(session);
    if (!isChannelEnabled(channelId)) {
      return {
        ok: false,
        error: '当前房间未启用五子棋插件。'
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

    const next = createGameState(session);
    saveGame(session, next);
    logInfo(logger, `started game in ${channelId} for ${next.hostName}`);
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
        error: '当前没有可加入的五子棋对局。'
      };
    }
    if (current.status !== STATUS_WAITING) {
      return {
        ok: false,
        error: '当前五子棋已经开始了。'
      };
    }
    if (current.hostId === userId) {
      return {
        ok: false,
        error: '你已经是这局五子棋的发起者了。'
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
    next.players[MARK_WHITE] = createParticipant(userId, username, MARK_WHITE);
    next.status = STATUS_PLAYING;
    next.currentTurn = MARK_BLACK;
    next.turnStartedAt = nowProvider();
    clearUndoState(next);
    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: createBoardText(next)
    };
  }

  function finalizeMove(next, mark, row, col) {
    if (isWinningMove(next.board, row, col, mark)) {
      next.status = getWinStatusFromMark(mark);
      next.currentTurn = '';
      return next;
    }

    if (isBoardFull(next.board)) {
      next.status = STATUS_DRAW;
      next.currentTurn = '';
      return next;
    }

    next.currentTurn = getOtherMark(mark);
    return next;
  }

  function applyPlayerMove(session, moveInput) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const playerMark = getParticipantMark(current, userId);
    const parsed = typeof moveInput === 'string' ? parseCoordinateText(moveInput) : moveInput;

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的五子棋。发送“@Bot 五子棋”开始。'
      };
    }

    if (!playerMark) {
      return {
        ok: false,
        error: '当前这局五子棋不属于你。'
      };
    }

    if (current.status === STATUS_WAITING) {
      return {
        ok: false,
        error: '当前五子棋还在等待第二位玩家加入。'
      };
    }

    if (current.status !== STATUS_PLAYING) {
      return {
        ok: false,
        error: '当前对局已结束。发送“重开”或“退出”继续。'
      };
    }

    if (current.pendingUndo) {
      return {
        ok: false,
        error: `当前有待处理的悔棋申请，等待 ${current.pendingUndo.approverName} 发送「同意」。`
      };
    }

    if (current.currentTurn !== playerMark) {
      return {
        ok: false,
        error: `还没轮到你。当前轮到 ${getParticipantName(current, current.currentTurn)}（${getMarkLabel(current.currentTurn)}）。`
      };
    }

    if (!parsed) {
      return {
        ok: false,
        error: '请发送坐标，如 D5、5D、D10、10D。'
      };
    }

    if (getCell(current.board, parsed.row, parsed.col)) {
      return {
        ok: false,
        error: `位置 ${parsed.coord} 已经被占了。`
      };
    }

    const next = clone(current);
    const playedAt = nowProvider();
    const startedAt = normalizeTimerTimestamp(current.turnStartedAt) || playedAt;
    const thinkMs = Math.max(0, playedAt - startedAt);

    next.board[toBoardIndex(parsed.row, parsed.col)] = playerMark;
    next.moveCount += 1;
    next.moveHistory = Array.isArray(next.moveHistory) ? next.moveHistory : [];
    next.moveHistory.push({
      row: parsed.row,
      col: parsed.col,
      mark: playerMark,
      userId,
      username: getSessionUsername(session) || '玩家',
      startedAt,
      playedAt,
      thinkMs
    });
    next.timers = next.timers && typeof next.timers === 'object' ? next.timers : createEmptyTimers();
    next.timers[playerMark] = getTimerBucket(next, playerMark);
    next.timers[playerMark].totalMs += thinkMs;
    next.timers[playerMark].lastMoveMs = thinkMs;
    next.lastMoveRow = parsed.row;
    next.lastMoveCol = parsed.col;
    next.lastMoveMark = playerMark;
    clearUndoState(next);
    finalizeMove(next, playerMark, parsed.row, parsed.col);
    next.turnStartedAt = next.status === STATUS_PLAYING ? playedAt : 0;

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
        error: '当前没有可重开的五子棋。'
      };
    }

    if (!isParticipant(current, userId) && current.hostId !== userId) {
      return {
        ok: false,
        error: `当前这局五子棋属于 ${current.hostName}。`
      };
    }

    const next = {
      ...clone(current),
      board: createEmptyBoard(),
      moveCount: 0,
      moveHistory: [],
      pendingUndo: null,
      timers: createEmptyTimers(),
      lastMoveRow: -1,
      lastMoveCol: -1,
      lastMoveMark: '',
      updatedAt: nowProvider(),
      status: current.players[MARK_WHITE] ? STATUS_PLAYING : STATUS_WAITING,
      currentTurn: MARK_BLACK,
      turnStartedAt: current.players[MARK_WHITE] ? nowProvider() : 0
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
        text: '当前没有进行中的五子棋。'
      };
    }

    if (!isParticipant(current, userId) && current.hostId !== userId) {
      return {
        ok: false,
        error: `当前这局五子棋属于 ${current.hostName}。`
      };
    }

    deleteGame(session);
    return {
      ok: true,
      text: `${username} 已退出，五子棋对局已结束。`
    };
  }

  function requestUndo(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const playerMark = getParticipantMark(current, userId);

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的五子棋。'
      };
    }

    if (!playerMark) {
      return {
        ok: false,
        error: '当前这局五子棋不属于你。'
      };
    }

    if (current.status === STATUS_WAITING) {
      return {
        ok: false,
        error: '当前五子棋还在等待第二位玩家加入。'
      };
    }

    if (current.pendingUndo) {
      if (current.pendingUndo.requesterId === userId) {
        return {
          ok: false,
          error: '你的悔棋申请还在等待对方同意。'
        };
      }
      return {
        ok: false,
        error: `当前已有 ${current.pendingUndo.requesterName} 发起的悔棋申请，请先处理。`
      };
    }

    const lastMove = getLastHistoryMove(current);
    if (!lastMove) {
      return {
        ok: false,
        error: '当前没有可悔的落子记录。'
      };
    }

    if (lastMove.userId !== userId) {
      return {
        ok: false,
        error: '只能为自己的上一步申请悔棋。'
      };
    }

    const request = createUndoRequest(current, playerMark);
    if (!request) {
      return {
        ok: false,
        error: '当前无法发起悔棋申请。'
      };
    }

    const next = clone(current);
    next.pendingUndo = request;
    next.turnStartedAt = 0;
    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: buildPrefixedBoardText(
        `${request.requesterName} 已发起悔棋申请，等待 ${request.approverName} 发送「同意」。`,
        next
      )
    };
  }

  function approveUndo(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    const playerMark = getParticipantMark(current, userId);

    if (!current) {
      return {
        ok: false,
        error: '当前没有进行中的五子棋。'
      };
    }

    if (!playerMark) {
      return {
        ok: false,
        error: '当前这局五子棋不属于你。'
      };
    }

    if (!current.pendingUndo) {
      return {
        ok: false,
        error: '当前没有待处理的悔棋申请。'
      };
    }

    if (current.pendingUndo.approverId !== userId) {
      return {
        ok: false,
        error: '只有对方玩家可以发送「同意」处理这次悔棋。'
      };
    }

    const next = clone(current);
    const moveHistory = Array.isArray(next.moveHistory) ? [...next.moveHistory] : [];
    const undoneMove = moveHistory.pop();
    if (!undoneMove) {
      return {
        ok: false,
        error: '悔棋记录已丢失，无法回滚。'
      };
    }

    next.board[toBoardIndex(undoneMove.row, undoneMove.col)] = '';
    next.moveCount = Math.max(0, next.moveCount - 1);
    next.moveHistory = moveHistory;
    next.timers = next.timers && typeof next.timers === 'object' ? next.timers : createEmptyTimers();
    next.timers[undoneMove.mark] = getTimerBucket(next, undoneMove.mark);
    next.timers[undoneMove.mark].totalMs = Math.max(0, next.timers[undoneMove.mark].totalMs - normalizeDurationMs(undoneMove.thinkMs));
    next.timers[undoneMove.mark].lastMoveMs = getLastMoveDurationForMark({ moveHistory }, undoneMove.mark);
    next.currentTurn = current.pendingUndo.requesterMark;
    next.status = next.players[MARK_WHITE] ? STATUS_PLAYING : STATUS_WAITING;
    next.turnStartedAt = next.status === STATUS_PLAYING ? nowProvider() : 0;
    clearUndoState(next);
    syncLastMoveFromHistory(next);

    saveGame(session, next);
    return {
      ok: true,
      state: next,
      text: buildPrefixedBoardText(
        `${getSessionUsername(session) || '玩家'} 已同意悔棋，撤销了 ${formatCoordinate(undoneMove.row, undoneMove.col)}。`,
        next
      )
    };
  }

  function getStatusText(session) {
    const current = getGame(session);
    if (!current) {
      return {
        ok: true,
        text: '当前没有进行中的五子棋。发送“@Bot 五子棋”开始。'
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
      '五子棋规则',
      '1) 棋盘为 13x13，黑先白后，先连成五子者获胜。',
      '2) 本插件仅支持双人模式：发起者执黑，加入者执白。',
      '3) 游戏中可直接发送坐标落子，支持 D5 / 5D / D10 / 10D / M13。',
      '4) 行坐标为 A-M，列坐标为 1-13。',
      '5) 支持操作：加入（等待时）、状态、悔棋、重开、退出。',
      '6) 悔棋规则：上一步玩家发送「悔棋」或「晦气」申请，对方发送「同意」后撤销上一步，并轮回悔棋方重新落子。',
      '7) 插件会记录双方累计用时、最近一步用时，以及当前手计时。',
      '8) 规则为自由连五，不包含禁手判定。',
      `注记: ${FOOTER_NOTE}`,
      '常用命令: 五子棋、加入、状态、悔棋、同意、重开、退出'
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

    if (current.status === STATUS_WAITING) {
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

    if (config.approveUndoKeywords.includes(rawText)) {
      return { type: 'approveUndo' };
    }

    if (config.undoKeywords.includes(rawText)) {
      return { type: 'undo' };
    }

    const coordinate = parseCoordinateText(rawText);
    if (coordinate) {
      return {
        type: 'move',
        value: coordinate
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
    if (parsed.type === 'undo') {
      return requestUndo(session);
    }
    if (parsed.type === 'approveUndo') {
      return approveUndo(session);
    }
    return getStatusText(session);
  }

  return {
    config: { ...config },
    startGame,
    joinGame,
    applyPlayerMove,
    requestUndo,
    approveUndo,
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
    summary: result.ok ? successSummary : 'gomoku validation message'
  });
}

function createStartTool(service) {
  return {
    name: 'games.gomoku.start',
    description: '开始一局双人五子棋。',
    aliases: ['五子棋', '连珠', 'gomoku', 'gobang'],
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
      directAliases: ['五子棋', '连珠', 'gomoku', 'gobang']
    },
    async execute(context = {}) {
      const result = service.startGame(context.session);
      return resultToToolReply('games.gomoku.start', result, 'gomoku opened');
    }
  };
}

function createJoinTool(service) {
  return {
    name: 'games.gomoku.join',
    description: '加入当前房间等待中的双人五子棋。',
    aliases: ['加入五子棋', '应战五子棋', '接受五子棋'],
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
      directAliases: ['加入五子棋', '应战五子棋', '接受五子棋']
    },
    async execute(context = {}) {
      const result = service.joinGame(context.session);
      return resultToToolReply('games.gomoku.join', result, 'gomoku joined');
    }
  };
}

function createStatusTool(service) {
  return {
    name: 'games.gomoku.status',
    description: '查看当前房间五子棋状态。',
    aliases: ['五子棋状态', '五子棋棋盘'],
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
      directAliases: ['五子棋状态', '五子棋棋盘']
    },
    async execute(context = {}) {
      const result = service.getStatusText(context.session);
      return createToolResult({
        ok: true,
        name: 'games.gomoku.status',
        result: result.text,
        summary: 'gomoku status'
      });
    }
  };
}

function createRulesTool(service) {
  return {
    name: 'games.gomoku.rules',
    description: '查看五子棋玩法规则。',
    aliases: ['五子棋规则', '连珠规则', 'gomoku规则'],
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
      directAliases: ['五子棋 规则', '五子棋规则', '连珠 规则']
    },
    async execute() {
      return createToolResult({
        ok: true,
        name: 'games.gomoku.rules',
        result: service.getRulesText(),
        summary: 'gomoku rules'
      });
    }
  };
}

function createRestartTool(service) {
  return {
    name: 'games.gomoku.restart',
    description: '重开当前房间的五子棋对局。',
    aliases: ['重开五子棋', '重新开始五子棋'],
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
      directAliases: ['重开五子棋', '重新开始五子棋']
    },
    async execute(context = {}) {
      const result = service.restartGame(context.session);
      return resultToToolReply('games.gomoku.restart', result, 'gomoku restarted');
    }
  };
}

function createUndoTool(service) {
  return {
    name: 'games.gomoku.undo',
    description: '为自己的上一步申请悔棋，等待对方发送“同意”。',
    aliases: ['悔棋', '晦气', '申请悔棋'],
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
      directAliases: ['悔棋', '晦气', '申请悔棋']
    },
    async execute(context = {}) {
      const result = service.requestUndo(context.session);
      return resultToToolReply('games.gomoku.undo', result, 'gomoku undo requested');
    }
  };
}

function createApproveUndoTool(service) {
  return {
    name: 'games.gomoku.approve_undo',
    description: '同意对方的悔棋申请。',
    aliases: ['同意悔棋', '同意'],
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
      directAliases: ['同意悔棋', '同意']
    },
    async execute(context = {}) {
      const result = service.approveUndo(context.session);
      return resultToToolReply('games.gomoku.approve_undo', result, 'gomoku undo approved');
    }
  };
}

function createQuitTool(service) {
  return {
    name: 'games.gomoku.quit',
    description: '结束当前房间的五子棋对局。',
    aliases: ['结束五子棋', '退出五子棋'],
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
      directAliases: ['结束五子棋', '退出五子棋']
    },
    async execute(context = {}) {
      const result = service.quitGame(context.session);
      return resultToToolReply('games.gomoku.quit', result, 'gomoku quit');
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
  name: 'games-gomoku',
  BOARD_SIZE,
  ROW_LABELS,
  createGomokuService,
  parseCoordinateText,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const service = createGomokuService({
      ...pluginConfig,
      botUid: context.config?.bot?.uid || DEFAULT_CONFIG.botUid,
      botName: pluginConfig.botName || context.config?.bot?.name || DEFAULT_CONFIG.botName,
      logger: context.logger || host.logger || console
    });

    host.registerService('games.gomoku', service);

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
      name: 'games-gomoku-package',
      version: '0.2.0',
      tools: [
        createStartTool(service),
        createJoinTool(service),
        createStatusTool(service),
        createRulesTool(service),
        createUndoTool(service),
        createApproveUndoTool(service),
        createRestartTool(service),
        createQuitTool(service)
      ],
      skills: [
        {
          id: 'games.gomoku',
          name: '五子棋',
          summary: '发起、加入并管理五子棋对局。',
          toolNames: [
            'games.gomoku.start',
            'games.gomoku.join',
            'games.gomoku.status',
            'games.gomoku.rules',
            'games.gomoku.undo',
            'games.gomoku.approve_undo',
            'games.gomoku.restart',
            'games.gomoku.quit'
          ],
          tags: ['games', 'gomoku'],
          examples: ['五子棋', '加入五子棋'],
          metadata: {
            priority: 75,
            pluginName: 'games-gomoku'
          }
        }
      ],
      metadata: {
        pluginName: 'games-gomoku',
        description: '无需 LLM 的准交互五子棋'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'games.gomoku.start',
              'games.gomoku.join',
              'games.gomoku.status',
              'games.gomoku.rules',
              'games.gomoku.undo',
              'games.gomoku.approve_undo',
              'games.gomoku.restart',
              'games.gomoku.quit'
            ]
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'games.gomoku.start',
              'games.gomoku.join',
              'games.gomoku.status',
              'games.gomoku.rules',
              'games.gomoku.undo',
              'games.gomoku.approve_undo',
              'games.gomoku.restart',
              'games.gomoku.quit'
            ]
          }
        }
      ]
    });
  }
};
