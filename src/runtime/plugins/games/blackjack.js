/**
 * Builtin plugin: blackjack
 * 房间态 21 点：公屏主持流程，私聊同步手牌。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const {
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId
} = require('../../../utils/session-metadata');
const { withIiroseMarkdownPrefix } = require('../../../utils/iirose-markdown');
const { isSameUid } = require('../../../utils/uid');

const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  dataDir: path.join(process.cwd(), 'data', 'games-blackjack'),
  stateFile: 'games.json',
  historyFile: 'history.json',
  historyLimit: 50,
  oneGamePerRoom: true,
  allowPrivate: false,
  includeRooms: [],
  excludeRooms: [],
  autoCleanupMs: 30 * 60 * 1000,
  joinWindowMs: 0,
  turnTimeoutMs: 60 * 1000,
  dealerStandScore: 17,
  minPlayers: 1,
  maxPlayers: 6,
  quoteReply: false,
  requireMentionToStart: false,
  maxQuickInputChars: 32,
  startKeywords: ['21点开局', 'bj开局', 'blackjack'],
  joinKeywords: ['加入21点', '加入bj', '加入'],
  leaveKeywords: ['退出21点', '退出bj', '退出'],
  beginKeywords: ['开始21点', '开始bj', '开牌'],
  hitKeywords: ['要牌', 'hit', '要'],
  standKeywords: ['停牌', 'stand', '停'],
  statusKeywords: ['21点状态', 'bj状态', '状态'],
  rulesKeywords: ['21点规则', 'bj规则', 'blackjack规则'],
  cancelKeywords: ['21点取消', '取消21点', '取消bj', '取消'],
  adminUids: []
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

function normalizeCommand(value, max = 120) {
  return normalizeText(value, max).toLowerCase();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => normalizeCommand(item, 120)).filter(Boolean))];
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

function normalizeTimerTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num >= 1e9 && num < 1e12 ? num * 1000 : Math.floor(num);
}

function normalizeDurationMs(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.max(0, Math.floor(num));
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

function resolveNow(config = {}) {
  if (typeof config.now === 'function') {
    const value = Number(config.now());
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return Date.now();
}

function createGameStore(config = {}) {
  const dataDir = path.resolve(config.dataDir || DEFAULT_CONFIG.dataDir);
  const filePath = path.resolve(dataDir, config.stateFile || DEFAULT_CONFIG.stateFile);
  let games = config.persist !== false ? readJsonFile(filePath, {}) : {};

  function cleanupExpired() {
    const now = resolveNow(config);
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

function createHistoryStore(config = {}) {
  const dataDir = path.resolve(config.dataDir || DEFAULT_CONFIG.dataDir);
  const filePath = path.resolve(dataDir, config.historyFile || DEFAULT_CONFIG.historyFile);
  let records = config.persist !== false ? readJsonFile(filePath, []) : [];

  function persist() {
    if (config.persist === false) return;
    writeJsonFile(filePath, records);
  }

  return {
    append(record) {
      records = [clone(record), ...records].slice(0, toPositiveInt(config.historyLimit, DEFAULT_CONFIG.historyLimit));
      persist();
      return clone(records[0]);
    },
    list() {
      return clone(records);
    }
  };
}

function createCard(rank, suit) {
  const normalizedRank = normalizeText(rank, 8).toUpperCase();
  const normalizedSuit = normalizeText(suit, 2);
  const value = normalizedRank === 'A'
    ? 11
    : (['J', 'Q', 'K'].includes(normalizedRank) ? 10 : Number(normalizedRank));

  return {
    rank: normalizedRank,
    suit: normalizedSuit,
    value: Number.isFinite(value) ? value : 0,
    code: `${normalizedRank}${normalizedSuit}`
  };
}

function normalizeCard(card = {}) {
  if (card && typeof card === 'object' && typeof card.code === 'string' && Number.isFinite(Number(card.value))) {
    return {
      rank: normalizeText(card.rank || '', 8).toUpperCase() || String(card.code).slice(0, -1).toUpperCase(),
      suit: normalizeText(card.suit || '', 2) || String(card.code).slice(-1),
      value: Number(card.value),
      code: normalizeText(card.code, 8)
    };
  }

  return createCard(card.rank || '', card.suit || '');
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(rank, suit));
    }
  }
  return deck;
}

function shuffleDeck(deck, random = Math.random) {
  const next = Array.isArray(deck) ? [...deck] : [];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

function calculateHandValue(hand = []) {
  let total = 0;
  let aces = 0;

  for (const item of hand) {
    const card = normalizeCard(item);
    total += card.value;
    if (card.rank === 'A') aces += 1;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    bestScore: total,
    isSoft: aces > 0
  };
}

function detectBlackjack(hand = []) {
  if (!Array.isArray(hand) || hand.length !== 2) return false;
  return calculateHandValue(hand).bestScore === 21;
}

function isBust(score) {
  return Number(score) > 21;
}

function dealerShouldHit(score, config) {
  return Number(score) < toPositiveInt(config.dealerStandScore, DEFAULT_CONFIG.dealerStandScore);
}

function getGameKey(session, config = {}) {
  const channelId = getSessionChannelId(session);
  if (!channelId) return '';
  if (config.oneGamePerRoom === false) {
    const userId = getSessionUserId(session) || 'unknown';
    return `blackjack:${channelId}:${userId}`;
  }
  return `blackjack:${channelId}`;
}

function createPlayer(session) {
  return {
    uid: getSessionUserId(session),
    username: getSessionUsername(session) || '玩家',
    hand: [],
    bestScore: 0,
    isSoft: false,
    isBlackjack: false,
    isBust: false,
    isStand: false,
    isDone: false,
    hasReceivedPrivateCards: false,
    result: ''
  };
}

function createDealer(uid = '', username = '庄家') {
  return {
    uid: normalizeText(uid, 120),
    username: normalizeText(username, 80) || '庄家',
    hand: [],
    bestScore: 0,
    isSoft: false,
    isBlackjack: false,
    isBust: false,
    revealed: false
  };
}

function hydratePlayer(player = {}) {
  const normalized = {
    uid: normalizeText(player.uid, 120),
    username: normalizeText(player.username, 80) || '玩家',
    hand: Array.isArray(player.hand) ? player.hand.map(normalizeCard) : [],
    bestScore: 0,
    isSoft: false,
    isBlackjack: player.isBlackjack === true,
    isBust: player.isBust === true,
    isStand: player.isStand === true,
    isDone: player.isDone === true,
    hasReceivedPrivateCards: player.hasReceivedPrivateCards === true,
    result: normalizeText(player.result, 80)
  };

  const score = calculateHandValue(normalized.hand);
  normalized.bestScore = score.bestScore;
  normalized.isSoft = score.isSoft;
  normalized.isBlackjack = normalized.hand.length === 2 && score.bestScore === 21 && normalized.isBlackjack !== false;
  normalized.isBust = score.bestScore > 21 || normalized.isBust;
  normalized.isDone = normalized.isDone || normalized.isBlackjack || normalized.isBust || normalized.isStand;
  return normalized;
}

function hydrateGame(game = {}) {
  const players = Array.isArray(game.players) ? game.players.map(hydratePlayer) : [];
  const dealer = createDealer(game.dealer?.uid, game.dealer?.username || game.hostName || '庄家');
  const dealerHand = Array.isArray(game.dealer?.hand) ? game.dealer.hand.map(normalizeCard) : [];
  const dealerScore = calculateHandValue(dealerHand);
  dealer.hand = dealerHand;
  dealer.bestScore = dealerScore.bestScore;
  dealer.isSoft = dealerScore.isSoft;
  dealer.isBlackjack = detectBlackjack(dealerHand);
  dealer.isBust = dealerScore.bestScore > 21;
  dealer.revealed = game.dealer?.revealed === true;

  return {
    gameId: normalizeText(game.gameId, 160),
    channelId: normalizeText(game.channelId, 160),
    status: normalizeText(game.status, 40) || 'waiting',
    hostId: normalizeText(game.hostId, 120),
    hostName: normalizeText(game.hostName, 80) || '玩家',
    createdAt: normalizeEpochTimestamp(game.createdAt),
    updatedAt: normalizeEpochTimestamp(game.updatedAt),
    joinDeadline: normalizeTimerTimestamp(game.joinDeadline),
    turnDeadline: normalizeTimerTimestamp(game.turnDeadline),
    currentPlayerIndex: Number.isInteger(game.currentPlayerIndex) ? game.currentPlayerIndex : 0,
    players,
    dealer,
    deck: Array.isArray(game.deck) ? game.deck.map(normalizeCard) : [],
    actionHistory: Array.isArray(game.actionHistory) ? clone(game.actionHistory) : []
  };
}

function formatDurationSeconds(ms, now = Date.now()) {
  const diff = Math.max(0, Math.ceil((Number(ms) - Number(now)) / 1000));
  return diff;
}

function formatCards(hand = []) {
  return hand.map(card => normalizeCard(card).code).join(' ');
}

function formatRoseMention(name = '') {
  const normalized = normalizeText(name, 80) || '玩家';
  return ` [*${normalized}*] `;
}

function renderBlackjackMessage(text = '') {
  const body = typeof text === 'string' ? text : String(text ?? '');
  return [
    '#### 21点',
    '```markdown',
    body,
    '```'
  ].join('\n');
}

function createBlackjackReplyOperation(text = '', metadata = {}) {
  return {
    kind: 'reply.current',
    content: {
      text: renderBlackjackMessage(text),
      renderMode: 'markdown',
      useMemePipeline: false
    },
    metadata: { ...metadata }
  };
}

function renderDealerPublic(game) {
  const dealer = game?.dealer || createDealer();
  if (dealer.revealed) {
    return `${formatCards(dealer.hand)} = ${dealer.bestScore}`;
  }
  const upCard = Array.isArray(dealer.hand) && dealer.hand.length > 0
    ? normalizeCard(dealer.hand[0]).code
    : '未知';
  return `${upCard} 暗牌`;
}

function getPlayerPublicState(player, isCurrent = false) {
  if (player.isStand) return '已停牌';
  if (player.isDone) return '已行动';
  if (isCurrent) return '行动中';
  return '等待中';
}

function renderPlayerSummary(game) {
  return (game.players || []).map((player, index) => {
    const prefix = game.status === 'player_turn' && index === game.currentPlayerIndex ? '-> ' : '- ';
    return `${prefix}${player.username}: ${getPlayerPublicState(player, index === game.currentPlayerIndex)}`;
  }).join('\n');
}

function renderPrivatePlayerHand(player, options = {}) {
  const lines = [];
  lines.push(`你的手牌：${formatCards(player.hand)} = ${player.bestScore}`);
  if (player.isBlackjack) {
    lines.push('你起手就是 Blackjack。');
  } else if (player.isBust) {
    lines.push('你已经爆牌。');
  } else if (player.isStand) {
    lines.push('你已停牌，等待本局结算。');
  } else if (options.includePrompt !== false) {
    lines.push('轮到你时，请在公屏发送“要牌”或“停牌”。');
  }
  return lines.join('\n');
}

function renderPrivateDealerHand(dealer, options = {}) {
  const lines = [];
  lines.push(`你的庄家手牌：${formatCards(dealer.hand)} = ${dealer.bestScore}`);
  if (dealer.isBlackjack) {
    lines.push('你起手就是 Blackjack。');
  } else if (dealer.isBust) {
    lines.push('你已经爆牌，本局将直接结算。');
  } else if (dealer.bestScore < 17) {
    lines.push('你当前不到 17 点，庄家规则要求你继续要牌。');
  } else if (options.includePrompt !== false) {
    lines.push('你可以在自己的庄家回合发送“要牌”或“停牌”。');
  }
  return lines.join('\n');
}

function renderSettlement(game) {
  const lines = [];
  lines.push('本局 21 点结算：');
  lines.push(`${game.dealer.username || '庄家'}：${formatCards(game.dealer.hand)} = ${game.dealer.bestScore}${game.dealer.isBust ? '（爆牌）' : ''}${game.dealer.isBlackjack ? '（Blackjack）' : ''}`);
  for (const player of game.players) {
    lines.push(`${player.username}：${formatCards(player.hand)} = ${player.bestScore}${player.isBust ? '（爆牌）' : ''}，${player.result || '待定'}`);
  }
  return lines.join('\n');
}

function createGameState(session, config, deckBuilder) {
  const now = resolveNow(config);
  const dealer = createPlayer(session);

  return {
    gameId: `blackjack:${getSessionChannelId(session)}:${now}`,
    channelId: getSessionChannelId(session),
    status: 'waiting',
    hostId: dealer.uid,
    hostName: dealer.username,
    createdAt: now,
    updatedAt: now,
    joinDeadline: config.joinWindowMs > 0 ? now + config.joinWindowMs : 0,
    turnDeadline: 0,
    currentPlayerIndex: 0,
    players: [],
    dealer: createDealer(dealer.uid, dealer.username),
    deck: typeof deckBuilder === 'function' ? deckBuilder() : [],
    actionHistory: []
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

function createBlackjackNotifier(options = {}) {
  const outputRuntime = options.outputRuntime || null;
  const pluginContext = options.pluginContext || {};
  const logger = options.logger || console;

  return {
    async sendRoom(session, text, extra = {}) {
      if (!outputRuntime || !session || !text) return { ok: false, error: 'output runtime not configured' };
      await outputRuntime.execute({
        ...createBlackjackReplyOperation(text, extra.metadata || {})
      }, buildExecutionContext({ session }, pluginContext));
      return { ok: true };
    },
    async sendPrivate(session, player, text) {
      if (!session || !player?.uid || !text) {
        return { ok: false, error: 'private output not configured' };
      }

      const routeChannelId = `private:${player.uid}`;
      const renderedText = renderBlackjackMessage(text);
      const bot = typeof session?.bot?.sendMessage === 'function'
        ? session.bot
        : (typeof pluginContext?.ctx?.bots?.[0]?.sendMessage === 'function' ? pluginContext.ctx.bots[0] : null);

      if (bot && typeof bot.sendMessage === 'function') {
        try {
          await bot.sendMessage(routeChannelId, withIiroseMarkdownPrefix(renderedText));
          return { ok: true };
        } catch (error) {
          logger.warn?.(`[games.blackjack] direct private notify failed for ${player.uid}: ${error.message}`);
          return {
            ok: false,
            error: error.message || 'private delivery failed'
          };
        }
      }

      if (!outputRuntime) {
        return { ok: false, error: 'private output not configured' };
      }

      try {
        const result = await outputRuntime.execute({
          kind: 'message.route',
          target: {
            scope: 'private',
            channelId: routeChannelId,
            userId: player.uid
          },
          content: {
            text: renderedText,
            renderMode: 'markdown',
            useMemePipeline: false
          },
          options: {
            recordConversation: false
          }
        }, buildExecutionContext({ session }, pluginContext));

        if (result?.ok === false) {
          return {
            ok: false,
            error: result.reason || result.error || 'private delivery blocked'
          };
        }

        return { ok: true };
      } catch (error) {
        logger.warn?.(`[games.blackjack] private notify failed for ${player.uid}: ${error.message}`);
        return {
          ok: false,
          error: error.message || 'private delivery failed'
        };
      }
    },
    async reportPrivateDeliveryFailure(session, player) {
      if (!session || !player) return { ok: false, error: 'session or player missing' };
      return this.sendRoom(session, `${player.username} 的手牌私聊发送失败，请检查私聊是否可用。`);
    }
  };
}

function createBlackjackService(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    autoCleanupMs: toPositiveInt(options.autoCleanupMs, DEFAULT_CONFIG.autoCleanupMs),
    joinWindowMs: normalizeDurationMs(options.joinWindowMs, DEFAULT_CONFIG.joinWindowMs),
    turnTimeoutMs: toPositiveInt(options.turnTimeoutMs, DEFAULT_CONFIG.turnTimeoutMs),
    dealerStandScore: toPositiveInt(options.dealerStandScore, DEFAULT_CONFIG.dealerStandScore),
    minPlayers: toPositiveInt(options.minPlayers, DEFAULT_CONFIG.minPlayers),
    maxPlayers: toPositiveInt(options.maxPlayers, DEFAULT_CONFIG.maxPlayers),
    maxQuickInputChars: toPositiveInt(options.maxQuickInputChars, DEFAULT_CONFIG.maxQuickInputChars),
    includeRooms: normalizeStringArray(options.includeRooms ?? DEFAULT_CONFIG.includeRooms),
    excludeRooms: normalizeStringArray(options.excludeRooms ?? DEFAULT_CONFIG.excludeRooms),
    startKeywords: normalizeStringArray(options.startKeywords ?? DEFAULT_CONFIG.startKeywords),
    joinKeywords: normalizeStringArray(options.joinKeywords ?? DEFAULT_CONFIG.joinKeywords),
    leaveKeywords: normalizeStringArray(options.leaveKeywords ?? DEFAULT_CONFIG.leaveKeywords),
    beginKeywords: normalizeStringArray(options.beginKeywords ?? DEFAULT_CONFIG.beginKeywords),
    hitKeywords: normalizeStringArray(options.hitKeywords ?? DEFAULT_CONFIG.hitKeywords),
    standKeywords: normalizeStringArray(options.standKeywords ?? DEFAULT_CONFIG.standKeywords),
    statusKeywords: normalizeStringArray(options.statusKeywords ?? DEFAULT_CONFIG.statusKeywords),
    rulesKeywords: normalizeStringArray(options.rulesKeywords ?? DEFAULT_CONFIG.rulesKeywords),
    cancelKeywords: normalizeStringArray(options.cancelKeywords ?? DEFAULT_CONFIG.cancelKeywords),
    adminUids: normalizeStringArray(options.adminUids ?? options.admins ?? DEFAULT_CONFIG.adminUids)
  };

  const logger = options.logger || console;
  const store = options.store || createGameStore(config);
  const historyStore = options.historyStore || createHistoryStore(config);
  const notifier = options.notifier || {
    async sendPrivate() { return { ok: false, error: 'notifier not configured' }; }
  };
  const deckFactory = typeof options.deckFactory === 'function' ? options.deckFactory : createDeck;
  const shuffleImpl = typeof options.shuffle === 'function' ? options.shuffle : null;
  const randomImpl = typeof options.random === 'function' ? options.random : Math.random;

  function isAdmin(userId = '') {
    return config.adminUids.some(item => isSameUid(item, userId));
  }

  function buildDeck() {
    const initialDeck = Array.isArray(deckFactory()) ? deckFactory().map(normalizeCard) : createDeck();
    if (shuffleImpl) {
      const shuffled = shuffleImpl(initialDeck.map(normalizeCard));
      if (Array.isArray(shuffled)) return shuffled.map(normalizeCard);
      return initialDeck.map(normalizeCard);
    }
    return shuffleDeck(initialDeck, randomImpl).map(normalizeCard);
  }

  function getGame(session) {
    const key = getGameKey(session, config);
    if (!key) return null;
    const value = store.get(key);
    return value ? hydrateGame(value) : null;
  }

  function saveGame(session, state) {
    const key = getGameKey(session, config);
    if (!key) return null;
    return hydrateGame(store.set(key, {
      ...clone(state),
      updatedAt: resolveNow(config)
    }));
  }

  function deleteGame(session) {
    const key = getGameKey(session, config);
    if (!key) return;
    store.delete(key);
  }

  function pushHistory(game) {
    historyStore.append({
      gameId: game.gameId,
      channelId: game.channelId,
      hostId: game.hostId,
      hostName: game.hostName,
      finishedAt: resolveNow(config),
      dealer: clone(game.dealer),
      players: clone(game.players),
      actionHistory: clone(game.actionHistory)
    });
  }

  function pushAction(game, type, payload = {}) {
    game.actionHistory = Array.isArray(game.actionHistory) ? game.actionHistory : [];
    game.actionHistory.push({
      at: resolveNow(config),
      type,
      ...payload
    });
  }

  function getPlayerIndexByUid(game, userId) {
    return (game.players || []).findIndex(player => isSameUid(player.uid, userId));
  }

  function getCurrentPlayer(game) {
    if (!game || game.currentPlayerIndex < 0 || game.currentPlayerIndex >= (game.players || []).length) {
      return null;
    }
    return game.players[game.currentPlayerIndex] || null;
  }

  function findNextActivePlayerIndex(game, startIndex = 0) {
    const players = Array.isArray(game.players) ? game.players : [];
    if (players.length === 0) return -1;

    const normalizedStart = ((Math.floor(startIndex) % players.length) + players.length) % players.length;
    for (let offset = 0; offset < players.length; offset += 1) {
      const index = (normalizedStart + offset) % players.length;
      const player = players[index];
      if (!player?.isDone) return index;
    }
    return -1;
  }

  function updatePlayerState(player) {
    const score = calculateHandValue(player.hand);
    player.bestScore = score.bestScore;
    player.isSoft = score.isSoft;
    player.isBlackjack = detectBlackjack(player.hand);
    player.isBust = isBust(score.bestScore);
    player.isDone = player.isBlackjack || player.isBust || player.isStand;
    return player;
  }

  function updateDealerState(dealer) {
    const score = calculateHandValue(dealer.hand);
    dealer.bestScore = score.bestScore;
    dealer.isSoft = score.isSoft;
    dealer.isBlackjack = detectBlackjack(dealer.hand);
    dealer.isBust = isBust(score.bestScore);
    return dealer;
  }

  function drawCard(game) {
    if (!Array.isArray(game.deck) || game.deck.length === 0) {
      return null;
    }
    return normalizeCard(game.deck.shift());
  }

  function canManageGame(game, userId) {
    return isSameUid(game.hostId, userId) || isAdmin(userId);
  }

  function renderWaitingText(game) {
    const now = resolveNow(config);
    const players = game.players.map(player => player.username).join('、');
    const lines = [
      `21点已开局，${game.hostName} 为庄家。`,
      `报名玩家：${players || '暂无'}。`,
      `报名人数：${game.players.length}/${config.maxPlayers}（至少 ${config.minPlayers} 人）。`,
      '发送“加入”或“加入21点”可报名，任意成员发送“退出”可结束当前对局。'
    ];

    if (game.joinDeadline > 0) {
      lines.push(`若开启等待计时，剩余 ${formatDurationSeconds(game.joinDeadline, now)} 秒。`);
    }

    lines.push('庄家发送“开始21点”可立即发牌。');
    return lines.join('\n');
  }

  function renderTurnPrompt(game) {
    const player = getCurrentPlayer(game);
    if (!player) return '所有玩家都已完成，准备进入庄家回合。';
    return [
      `${game.dealer.username || '庄家'} 明牌：${renderDealerPublic(game)}。`,
      renderPlayerSummary(game),
      `当前玩家：${formatRoseMention(player.username)}，请发送“要牌”或“停牌”。`
    ].join('\n');
  }

  function renderGameStatus(game) {
    if (!game) {
      return '当前没有进行中的21点对局。发送“21点开局”开始。';
    }

    if (game.status === 'waiting') {
      return renderWaitingText(game);
    }

    return [
      `21点进行中（${game.status}）。`,
      `${game.dealer.username || '庄家'}：${renderDealerPublic(game)}。`,
      renderPlayerSummary(game)
    ].filter(Boolean).join('\n');
  }

  function getRulesText() {
    return [
      '21点规则：',
      '- 开局者为庄家，其他玩家发送“加入”或“加入21点”报名。',
      '- 庄家发送“开始21点”发牌；玩家在自己的回合可连续要牌，直到主动停牌或爆牌。',
      '- 公屏负责主持流程，机器人会尽量通过私聊发送玩家手牌。',
      '- A 按 1 或 11 计分，J/Q/K 按 10 计分。',
      '- 庄家小于 17 必须补牌，达到 17 或更高则停牌。',
      '- 起手两张 21 记为 Blackjack，高于普通 21。',
      '- 同房间默认同一时间只允许一局 21 点。'
    ].join('\n');
  }

  async function notifyPlayerHand(session, player, prefix = '') {
    if (!notifier || typeof notifier.sendPrivate !== 'function') {
      player.hasReceivedPrivateCards = false;
      return `${player.username} 的手牌私聊发送失败，请检查私聊是否可用。`;
    }

    const text = [prefix, renderPrivatePlayerHand(player)].filter(Boolean).join('\n');
    const result = await notifier.sendPrivate(session, player, text);
    player.hasReceivedPrivateCards = result.ok === true;
    return result.ok ? '' : `${player.username} 的手牌私聊发送失败，请检查私聊是否可用。`;
  }

  async function notifyDealerHand(session, dealer, prefix = '') {
    if (!notifier || typeof notifier.sendPrivate !== 'function') {
      return `${dealer.username} 的庄家手牌私聊发送失败，请检查私聊是否可用。`;
    }

    const text = [prefix, renderPrivateDealerHand(dealer)].filter(Boolean).join('\n');
    const result = await notifier.sendPrivate(session, {
      uid: dealer.uid,
      username: dealer.username
    }, text);
    return result.ok ? '' : `${dealer.username} 的庄家手牌私聊发送失败，请检查私聊是否可用。`;
  }

  function settlePlayerVsDealer(player, dealer) {
    if (player.isBust) return '爆牌失败';
    if (dealer.isBust) {
      return player.isBlackjack ? 'Blackjack 获胜' : '获胜';
    }
    if (player.isBlackjack && !dealer.isBlackjack) return 'Blackjack 获胜';
    if (!player.isBlackjack && dealer.isBlackjack) return '失败';
    if (player.bestScore > dealer.bestScore) return '获胜';
    if (player.bestScore < dealer.bestScore) return '失败';
    return '平局';
  }

  async function finalizeGame(session, game, prefix = '') {
    const next = hydrateGame(game);
    next.status = 'dealer_turn';
    next.dealer.revealed = true;
    updateDealerState(next.dealer);

    if (!next.dealer.isBlackjack) {
      while (!next.dealer.isBust && dealerShouldHit(next.dealer.bestScore, config)) {
        const drawn = drawCard(next);
        if (!drawn) break;
        next.dealer.hand.push(drawn);
        updateDealerState(next.dealer);
        pushAction(next, 'dealer-hit', { detail: `draw ${drawn.code}` });
      }
    }

    for (const player of next.players) {
      player.result = settlePlayerVsDealer(player, next.dealer);
    }

    next.status = 'settled';
    pushAction(next, 'settled');
    pushHistory(next);
    deleteGame(session);

    return {
      ok: true,
      text: [prefix, renderSettlement(next)].filter(Boolean).join('\n\n')
    };
  }

  function buildDealerTurnText(game, prefix = '') {
    return [
      prefix,
      `${game.dealer.username || '庄家'} 进入庄家回合。`,
      `${game.dealer.username || '庄家'} 明牌：${renderDealerPublic(game)}。`,
      `当前玩家：${formatRoseMention(game.dealer.username || '庄家')}，请发送“要牌”或“停牌”。`
    ].filter(Boolean).join('\n');
  }

  async function advanceAfterPlayerAction(session, game, prefix = '') {
    const nextIndex = findNextActivePlayerIndex(game, game.currentPlayerIndex + 1);
    if (nextIndex < 0) {
      game.status = 'dealer_turn';
      game.turnDeadline = 0;
      const saved = saveGame(session, game);
      return {
        ok: true,
        text: buildDealerTurnText(saved, prefix)
      };
    }

    game.currentPlayerIndex = nextIndex;
    game.status = 'player_turn';
    game.turnDeadline = 0;
    const saved = saveGame(session, game);
    return {
      ok: true,
      text: [prefix, renderTurnPrompt(saved)].filter(Boolean).join('\n')
    };
  }

  async function beginGame(session, options = {}) {
    const current = getGame(session);
    const userId = getSessionUserId(session);

    if (!current) {
      return {
        ok: false,
        error: '当前没有可开始的21点对局。'
      };
    }
    if (current.status !== 'waiting') {
      return {
        ok: false,
        error: '当前21点对局已经开始了。'
      };
    }
    if (options.skipPermission !== true && !canManageGame(current, userId)) {
      return {
        ok: false,
        error: '只有房主或管理员可以开始当前21点对局。'
      };
    }
    if (current.players.length < config.minPlayers) {
      return {
        ok: false,
        error: `当前人数不足，至少需要 ${config.minPlayers} 人。`
      };
    }

    const next = hydrateGame(current);
    next.status = 'dealing';
    next.deck = buildDeck();
    next.dealer = createDealer(next.hostId, next.hostName);
    next.currentPlayerIndex = 0;
    next.turnDeadline = 0;

    for (const player of next.players) {
      player.hand = [];
      player.bestScore = 0;
      player.isSoft = false;
      player.isBlackjack = false;
      player.isBust = false;
      player.isStand = false;
      player.isDone = false;
      player.hasReceivedPrivateCards = false;
      player.result = '';
    }

    for (const player of next.players) {
      const card = drawCard(next);
      if (!card) {
        return { ok: false, error: '牌堆初始化失败，无法开始本局。' };
      }
      player.hand.push(card);
    }

    let card = drawCard(next);
    if (!card) return { ok: false, error: '牌堆初始化失败，无法开始本局。' };
    next.dealer.hand.push(card);

    for (const player of next.players) {
      card = drawCard(next);
      if (!card) {
        return { ok: false, error: '牌堆初始化失败，无法开始本局。' };
      }
      player.hand.push(card);
      updatePlayerState(player);
      if (player.isBlackjack) {
        player.isDone = true;
      }
    }

    card = drawCard(next);
    if (!card) return { ok: false, error: '牌堆初始化失败，无法开始本局。' };
    next.dealer.hand.push(card);
    updateDealerState(next.dealer);
    next.dealer.revealed = false;
    pushAction(next, 'began', { by: options.skipPermission === true ? 'system' : userId || 'unknown' });

    const warnings = [];
    const dealerWarning = await notifyDealerHand(session, next.dealer);
    if (dealerWarning) warnings.push(`- ${dealerWarning}`);
    for (const player of next.players) {
      const warning = await notifyPlayerHand(session, player);
      if (warning) warnings.push(`- ${warning}`);
    }

    if (next.dealer.isBlackjack) {
      return finalizeGame(session, next, [
        options.prefix || '',
        '庄家起手就是 Blackjack。',
        warnings.length > 0 ? `注意：\n${warnings.join('\n')}` : ''
      ].filter(Boolean).join('\n'));
    }

    const nextIndex = findNextActivePlayerIndex(next, 0);
    if (nextIndex < 0) {
      return finalizeGame(session, next, [
        options.prefix || '',
        warnings.length > 0 ? `注意：\n${warnings.join('\n')}` : ''
      ].filter(Boolean).join('\n'));
    }

    next.status = 'player_turn';
    next.currentPlayerIndex = nextIndex;
    next.turnDeadline = 0;
    const saved = saveGame(session, next);

    return {
      ok: true,
      text: [
        options.prefix || '',
        `21点报名结束，玩家：${saved.players.map(player => player.username).join('、')}。`,
        warnings.length > 0 ? `注意：\n${warnings.join('\n')}` : '',
        renderTurnPrompt(saved)
      ].filter(Boolean).join('\n')
    };
  }

  async function reconcileGameState(session) {
    const current = getGame(session);
    if (!current) return { state: null, result: null };

    const now = resolveNow(config);
    if (config.joinWindowMs > 0 && current.status === 'waiting' && current.joinDeadline > 0 && now >= current.joinDeadline) {
      if (current.players.length >= config.minPlayers) {
        return {
          state: null,
          result: await beginGame(session, {
            skipPermission: true,
            prefix: '报名时间到，自动开始。'
          })
        };
      }
      deleteGame(session);
      return {
        state: null,
        result: {
          ok: true,
          text: '21点报名超时，人数不足，本局已自动取消。'
        }
      };
    }

    return { state: current, result: null };
  }

  async function startGame(session) {
    const channelId = getSessionChannelId(session);
    const userId = getSessionUserId(session);

    if (!config.enabled) {
      return {
        ok: false,
        error: '21点插件当前未启用。'
      };
    }
    if (!userId || !channelId) {
      return {
        ok: false,
        error: '无法识别当前房间或用户，不能创建21点对局。'
      };
    }
    if (!isRoomAllowed(channelId, config)) {
      return {
        ok: false,
        error: '当前房间未启用21点插件。'
      };
    }

    const current = getGame(session);
    if (current && ['waiting', 'dealing', 'player_turn', 'dealer_turn'].includes(current.status)) {
      if (isSameUid(current.hostId, userId)) {
        return {
          ok: true,
          text: renderGameStatus(current)
        };
      }
      return {
        ok: false,
        error: `当前房间已有 ${current.hostName} 作为庄家开启的21点对局。`
      };
    }

    const next = createGameState(session, config, buildDeck);
    pushAction(next, 'created', { uid: userId, username: next.hostName });
    saveGame(session, next);
    return {
      ok: true,
      text: renderWaitingText(next)
    };
  }

  async function joinGame(session) {
    const sync = await reconcileGameState(session);
    if (sync.result) return sync.result;

    const current = sync.state;
    const userId = getSessionUserId(session);
    const username = getSessionUsername(session) || '玩家';

    if (!current) {
      return {
        ok: false,
        error: '当前没有可加入的21点对局。'
      };
    }
    if (current.status !== 'waiting') {
      return {
        ok: false,
        error: '当前21点对局已经开始，无法继续加入。'
      };
    }
    if (isSameUid(current.hostId, userId)) {
      return {
        ok: false,
        error: '庄家已经在当前对局中，不需要再次加入。'
      };
    }
    if (getPlayerIndexByUid(current, userId) >= 0) {
      return {
        ok: true,
        text: renderWaitingText(current)
      };
    }
    if (current.players.length >= config.maxPlayers) {
      return {
        ok: false,
        error: `当前21点人数已满，最多 ${config.maxPlayers} 人。`
      };
    }

    const next = hydrateGame(current);
    next.players.push({
      uid: userId,
      username,
      hand: [],
      bestScore: 0,
      isSoft: false,
      isBlackjack: false,
      isBust: false,
      isStand: false,
      isDone: false,
      hasReceivedPrivateCards: false,
      result: ''
    });
    pushAction(next, 'joined', { uid: userId, username });
    const saved = saveGame(session, next);
    return {
      ok: true,
      text: `${username} 加入成功，当前 ${saved.players.length} 人：${saved.players.map(player => player.username).join('、')}。\n庄家 ${saved.hostName} 发送“开始21点”可立即发牌。`
    };
  }

  async function leaveGame(session) {
    const sync = await reconcileGameState(session);
    if (sync.result) return sync.result;

    const current = sync.state;
    const username = getSessionUsername(session) || '玩家';
    if (!current) {
      return {
        ok: false,
        error: '当前没有可退出的21点对局。'
      };
    }

    pushAction(current, 'cancelled-by-exit', {
      uid: getSessionUserId(session),
      username
    });
    deleteGame(session);
    return {
      ok: true,
      text: `${username} 已通过“退出”结束当前21点对局。`
    };
  }

  async function applyHit(session) {
    const sync = await reconcileGameState(session);
    if (sync.result) return sync.result;

    const current = sync.state;
    const userId = getSessionUserId(session);
    if (!current) {
      return { ok: false, error: '当前没有进行中的21点对局。' };
    }
    if (current.status !== 'player_turn' && current.status !== 'dealer_turn') {
      return { ok: false, error: '当前不是可操作阶段。' };
    }

    if (current.status === 'dealer_turn') {
      if (!isSameUid(current.hostId, userId)) {
        return { ok: false, error: `当前轮到庄家 ${current.hostName} 操作。` };
      }

      const next = hydrateGame(current);
      const card = drawCard(next);
      if (!card) {
        return { ok: false, error: '牌堆不足，无法继续补牌。' };
      }

      next.dealer.hand.push(card);
      updateDealerState(next.dealer);
      pushAction(next, 'dealer-hit', { uid: next.dealer.uid, username: next.dealer.username, detail: `draw ${card.code}` });

      const warning = await notifyDealerHand(session, next.dealer, `你抽到：${card.code}`);
      if (next.dealer.isBust) {
        return finalizeGame(session, next, [
          `${next.dealer.username} 选择要牌。`,
          warning ? `注意：${warning}` : ''
        ].filter(Boolean).join('\n'));
      }

      const saved = saveGame(session, next);
      return {
        ok: true,
        text: [
          `${saved.dealer.username} 选择要牌。`,
          warning ? `注意：${warning}` : '',
          buildDealerTurnText(saved)
        ].filter(Boolean).join('\n')
      };
    }

    const next = hydrateGame(current);
    const player = getCurrentPlayer(next);
    if (!player || !isSameUid(player.uid, userId)) {
      return { ok: false, error: `还没轮到你。当前轮到 ${player?.username || '未知玩家'}。` };
    }

    const card = drawCard(next);
    if (!card) {
      return { ok: false, error: '牌堆不足，无法继续补牌。' };
    }

    player.hand.push(card);
    updatePlayerState(player);
    if (player.bestScore === 21 && !player.isBust) {
      player.isStand = true;
      player.isDone = true;
    }
    pushAction(next, 'player-hit', { uid: player.uid, username: player.username, detail: `draw ${card.code}` });

    const warning = await notifyPlayerHand(session, player, `你抽到：${card.code}`);

    if (player.isBust) {
      return advanceAfterPlayerAction(session, next, [
        `${player.username} 选择要牌，结果已私聊发送。`,
        `${player.username} 爆牌。`,
        warning ? `注意：${warning}` : ''
      ].filter(Boolean).join('\n'));
    }

    const saved = saveGame(session, next);
    return {
      ok: true,
      text: [
        `${player.username} 选择要牌，结果已私聊发送。`,
        warning ? `注意：${warning}` : '',
        renderTurnPrompt(saved)
      ].filter(Boolean).join('\n')
    };
  }

  async function applyStand(session) {
    const sync = await reconcileGameState(session);
    if (sync.result) return sync.result;

    const current = sync.state;
    const userId = getSessionUserId(session);
    if (!current) {
      return { ok: false, error: '当前没有进行中的21点对局。' };
    }
    if (current.status !== 'player_turn' && current.status !== 'dealer_turn') {
      return { ok: false, error: '当前不是可操作阶段。' };
    }

    if (current.status === 'dealer_turn') {
      if (!isSameUid(current.hostId, userId)) {
        return { ok: false, error: `当前轮到庄家 ${current.hostName} 操作。` };
      }

      const next = hydrateGame(current);
      updateDealerState(next.dealer);
      if (next.dealer.bestScore < config.dealerStandScore) {
        return { ok: false, error: `庄家当前仅 ${next.dealer.bestScore} 点，不到 ${config.dealerStandScore} 点，必须继续要牌。` };
      }
      pushAction(next, 'dealer-stand', { uid: next.dealer.uid, username: next.dealer.username });
      return finalizeGame(session, next, `${next.dealer.username} 选择停牌。`);
    }

    const next = hydrateGame(current);
    const player = getCurrentPlayer(next);
    if (!player || !isSameUid(player.uid, userId)) {
      return { ok: false, error: `还没轮到你。当前轮到 ${player?.username || '未知玩家'}。` };
    }

    player.isStand = true;
    player.isDone = true;
    updatePlayerState(player);
    pushAction(next, 'player-stand', { uid: player.uid, username: player.username });
    return advanceAfterPlayerAction(session, next, `${player.username} 选择停牌。`);
  }

  async function cancelGame(session) {
    const current = getGame(session);
    const userId = getSessionUserId(session);
    if (!current) {
      return { ok: false, error: '当前没有可取消的21点对局。' };
    }
    if (!canManageGame(current, userId)) {
      return { ok: false, error: '只有房主或管理员可以取消当前21点对局。' };
    }

    deleteGame(session);
    return {
      ok: true,
      text: `${getSessionUsername(session) || '玩家'} 已取消当前21点对局。`
    };
  }

  async function getStatusText(session) {
    const sync = await reconcileGameState(session);
    if (sync.result) return sync.result;
    return {
      ok: true,
      text: renderGameStatus(sync.state)
    };
  }

  function parseQuickInput(session) {
    const rawText = normalizeText(session?.content, config.maxQuickInputChars);
    if (!rawText || rawText.length > config.maxQuickInputChars) return null;
    if (/<at\b|id="/i.test(rawText)) return null;

    const text = normalizeCommand(rawText, config.maxQuickInputChars);
    const current = getGame(session);

    if (!current) {
      if (config.startKeywords.includes(text)) return { type: 'start' };
      if (config.rulesKeywords.includes(text)) return { type: 'rules' };
      return null;
    }

    if (config.rulesKeywords.includes(text)) return { type: 'rules' };
    if (config.statusKeywords.includes(text)) return { type: 'status' };
    if (config.leaveKeywords.includes(text)) return { type: 'leave' };
    if (config.cancelKeywords.includes(text)) return { type: 'cancel' };

    if (current.status === 'waiting') {
      if (config.joinKeywords.includes(text)) return { type: 'join' };
      if (config.beginKeywords.includes(text)) return { type: 'begin' };
      return null;
    }

    if (current.status === 'player_turn') {
      if (config.hitKeywords.includes(text)) return { type: 'hit' };
      if (config.standKeywords.includes(text)) return { type: 'stand' };
      return null;
    }

    if (current.status === 'dealer_turn') {
      if (config.hitKeywords.includes(text)) return { type: 'hit' };
      if (config.standKeywords.includes(text)) return { type: 'stand' };
      return null;
    }

    return null;
  }

  async function handleQuickInput(session) {
    const parsed = parseQuickInput(session);
    if (!parsed) return null;
    if (parsed.type === 'start') return startGame(session);
    if (parsed.type === 'join') return joinGame(session);
    if (parsed.type === 'leave') return leaveGame(session);
    if (parsed.type === 'begin') return beginGame(session);
    if (parsed.type === 'hit') return applyHit(session);
    if (parsed.type === 'stand') return applyStand(session);
    if (parsed.type === 'cancel') return cancelGame(session);
    if (parsed.type === 'rules') {
      return {
        ok: true,
        text: getRulesText()
      };
    }
    return getStatusText(session);
  }

  return {
    config: { ...config },
    startGame,
    joinGame,
    leaveGame,
    beginGame,
    applyHit,
    applyStand,
    cancelGame,
    getStatusText,
    getRulesText,
    getGame,
    handleQuickInput,
    parseQuickInput,
    settlePlayerVsDealer
  };
}

function resultToToolReply(toolName, result, successSummary) {
  const replyText = result.ok ? result.text : result.error;
  return createToolResult({
    ok: true,
    name: toolName,
    result: replyText,
    outputs: [
      createBlackjackReplyOperation(replyText)
    ],
    summary: result.ok ? successSummary : 'blackjack validation message'
  });
}

function createStartTool(service) {
  return {
    name: 'games.blackjack.start',
    description: '开始一局 Blackjack / 21点。示例：21点开局。',
    aliases: ['21点开局', 'bj开局', 'blackjack'],
    inputSchema: {
      type: 'object',
      properties: {
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
    metadata: {
      directMatch: true,
      directAliases: ['21点开局', 'bj开局', 'blackjack']
    },
    async execute(context = {}) {
      const result = await service.startGame(context.session);
      return resultToToolReply('games.blackjack.start', result, 'blackjack opened');
    }
  };
}

function createJoinTool(service) {
  return {
    name: 'games.blackjack.join',
    description: '加入当前房间等待中的 21 点对局。',
    aliases: ['加入21点', '加入bj', '加入'],
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
      directAliases: ['加入21点', '加入bj', '加入']
    },
    async execute(context = {}) {
      const result = await service.joinGame(context.session);
      return resultToToolReply('games.blackjack.join', result, 'blackjack joined');
    }
  };
}

function createBeginTool(service) {
  return {
    name: 'games.blackjack.begin',
    description: '开始当前 21 点对局并发牌。',
    aliases: ['开始21点', '开始bj', '开牌'],
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
      directAliases: ['开始21点', '开始bj', '开牌']
    },
    async execute(context = {}) {
      const result = await service.beginGame(context.session);
      return resultToToolReply('games.blackjack.begin', result, 'blackjack began');
    }
  };
}

function createHitTool(service) {
  return {
    name: 'games.blackjack.hit',
    description: '当前轮到你时补一张牌。',
    aliases: ['21点要牌', '要牌', 'hit'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    async execute(context = {}) {
      const result = await service.applyHit(context.session);
      return resultToToolReply('games.blackjack.hit', result, 'blackjack hit');
    }
  };
}

function createStandTool(service) {
  return {
    name: 'games.blackjack.stand',
    description: '当前轮到你时停牌。',
    aliases: ['21点停牌', '停牌', 'stand'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    async execute(context = {}) {
      const result = await service.applyStand(context.session);
      return resultToToolReply('games.blackjack.stand', result, 'blackjack stand');
    }
  };
}

function createLeaveTool(service) {
  return {
    name: 'games.blackjack.leave',
    description: '结束当前 21 点对局。任何成员发送“退出”都可终止本局。',
    aliases: ['退出21点', '退出bj'],
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
      directAliases: ['退出21点', '退出bj']
    },
    async execute(context = {}) {
      const result = await service.leaveGame(context.session);
      return resultToToolReply('games.blackjack.leave', result, 'blackjack left');
    }
  };
}

function createStatusTool(service) {
  return {
    name: 'games.blackjack.status',
    description: '查看当前房间 21 点状态。',
    aliases: ['21点状态', 'bj状态'],
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
      directAliases: ['21点状态', 'bj状态']
    },
    async execute(context = {}) {
      const result = await service.getStatusText(context.session);
      return createToolResult({
        ok: true,
        name: 'games.blackjack.status',
        result: result.text,
        outputs: [
          createBlackjackReplyOperation(result.text)
        ],
        summary: 'blackjack status'
      });
    }
  };
}

function createRulesTool(service) {
  return {
    name: 'games.blackjack.rules',
    description: '查看 21 点玩法规则。',
    aliases: ['21点规则', 'bj规则', 'blackjack规则'],
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
      directAliases: ['21点规则', 'bj规则', 'blackjack规则']
    },
    async execute() {
      const rulesText = service.getRulesText();
      return createToolResult({
        ok: true,
        name: 'games.blackjack.rules',
        result: rulesText,
        outputs: [
          createBlackjackReplyOperation(rulesText)
        ],
        summary: 'blackjack rules'
      });
    }
  };
}

function createCancelTool(service) {
  return {
    name: 'games.blackjack.cancel',
    description: '取消当前房间 21 点对局。',
    aliases: ['21点取消', '取消21点', '取消bj'],
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
      directAliases: ['21点取消', '取消21点', '取消bj']
    },
    async execute(context = {}) {
      const result = await service.cancelGame(context.session);
      return resultToToolReply('games.blackjack.cancel', result, 'blackjack cancelled');
    }
  };
}

function createBlackjackToolBundle(service) {
  return [
    createStartTool(service),
    createJoinTool(service),
    createBeginTool(service),
    createHitTool(service),
    createStandTool(service),
    createLeaveTool(service),
    createStatusTool(service),
    createRulesTool(service),
    createCancelTool(service)
  ];
}

async function sendReply(pluginContext, session, text) {
  if (!pluginContext.outputRuntime || !session || !text) return;
  await pluginContext.outputRuntime.execute({
    ...createBlackjackReplyOperation(text)
  }, buildExecutionContext({ session }, pluginContext));
}

function logInfo(logger, message) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`[games.blackjack] ${message}`);
  }
}

module.exports = {
  name: 'games-blackjack',
  createBlackjackNotifier,
  createBlackjackService,
  createBlackjackToolBundle,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const notifier = createBlackjackNotifier({
      outputRuntime: context.outputRuntime,
      pluginContext: context,
      logger: context.logger || host.logger || console
    });
    const service = createBlackjackService({
      ...pluginConfig,
      adminUids: Array.isArray(context.config?.admins) ? context.config.admins : [],
      notifier,
      logger: context.logger || host.logger || console
    });

    host.registerService('games.blackjack', service);

    const cleanup = context.ctx?.on?.('message', async (session) => {
      try {
        const userId = getSessionUserId(session);
        const botId = normalizeText(context.config?.bot?.uid, 80);
        if (!userId || (botId && userId === botId)) return;

        const result = await service.handleQuickInput(session);
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
      name: 'games-blackjack-package',
      version: '0.1.0',
      tools: createBlackjackToolBundle(service),
      skills: [
        {
          id: 'games.blackjack',
          name: '21点',
          summary: '发起、加入并管理房间态 21 点对局。',
          toolNames: [
            'games.blackjack.start',
            'games.blackjack.join',
            'games.blackjack.begin',
            'games.blackjack.hit',
            'games.blackjack.stand',
            'games.blackjack.leave',
            'games.blackjack.status',
            'games.blackjack.rules',
            'games.blackjack.cancel'
          ],
          tags: ['games', 'blackjack'],
          examples: ['21点开局', '加入21点'],
          metadata: {
            priority: 78,
            pluginName: 'games-blackjack'
          }
        }
      ],
      metadata: {
        pluginName: 'games-blackjack',
        description: '机器人主持的房间态 Blackjack / 21点'
      },
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'games.blackjack.start',
              'games.blackjack.join',
              'games.blackjack.begin',
              'games.blackjack.hit',
              'games.blackjack.stand',
              'games.blackjack.leave',
              'games.blackjack.status',
              'games.blackjack.rules',
              'games.blackjack.cancel'
            ]
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'games.blackjack.start',
              'games.blackjack.join',
              'games.blackjack.begin',
              'games.blackjack.hit',
              'games.blackjack.stand',
              'games.blackjack.leave',
              'games.blackjack.status',
              'games.blackjack.rules',
              'games.blackjack.cancel'
            ]
          }
        }
      ]
    });
  }
};
