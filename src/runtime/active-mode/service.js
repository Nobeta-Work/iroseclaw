/**
 * Native active-mode service
 * 负责把“主动模式”从插件形态收敛到框架内核的消息评估逻辑。
 */

const { invokeWorkflowChat } = require('../message/handler');
const { TriggerRouter, extractSessionTimestamp } = require('../trigger/router');

const DEFAULT_CONFIG = {
  mode: 'none',
  reference: [],
  company: [],
  windowMs: 45000,
  minMessages: 4,
  minParticipants: 2,
  maxAverageGapMs: 18000,
  maxSpeakerRatio: 0.75,
  minBotSilenceMs: 45000,
  cooldownMs: 3 * 60 * 1000,
  maxPromptMessages: 10,
  includeRooms: [],
  excludeRooms: [],
  shouldIntervene: null
};

const MODE_LABELS = {
  none: '无介入模式',
  companion: '伴随模式',
  high: '高介入模式'
};

const ACTIVE_MODE_OPTIONS = [
  {
    mode: 'none',
    label: MODE_LABELS.none,
    aliases: ['无介入', '零介入', 'none', 'off', 'disable', 'disabled', 'inactive'],
    description: '只响应 @ / 关键词 / 引用'
  },
  {
    mode: 'companion',
    label: MODE_LABELS.companion,
    aliases: ['伴随', '陪伴模式', 'company', 'companion'],
    description: '仅在陪伴列表成员参与主动条件窗口时介入'
  },
  {
    mode: 'high',
    label: MODE_LABELS.high,
    aliases: ['高介入', '高介入模式', 'high', 'high-intervention', 'high_intervention'],
    description: '任何人的主动条件都可触发'
  }
];

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function normalizeEpochTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return Date.now();
  }

  const normalized = Math.floor(num);
  if (normalized >= 1e9 && normalized < 1e12) {
    return normalized * 1000;
  }
  return normalized;
}

function normalizeText(value, maxChars = 120) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxChars);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => normalizeText(item, 160))
      .filter(Boolean)
  )];
}

function resolveActiveModeMode(value) {
  const text = normalizeText(value, 32).toLowerCase();
  if (!text) return '';

  if (['none', 'off', 'disable', 'disabled', 'inactive', '无介入模式', '无介入', '零介入'].includes(text)) {
    return 'none';
  }
  if (['companion', 'company', '伴随模式', '伴随', '陪伴模式'].includes(text)) {
    return 'companion';
  }
  if (['high', 'high-intervention', 'high_intervention', '高介入模式', '高介入'].includes(text)) {
    return 'high';
  }

  return '';
}

function normalizeMode(value) {
  const resolved = resolveActiveModeMode(value);
  if (resolved) return resolved;
  return DEFAULT_CONFIG.mode;
}

function describeActiveMode(value) {
  const mode = normalizeMode(value);
  return ACTIVE_MODE_OPTIONS.find(item => item.mode === mode) || ACTIVE_MODE_OPTIONS[0];
}

function resolveRequestedActiveMode(value) {
  const text = normalizeText(value, 160).toLowerCase();
  if (!text) return '';

  for (const option of ACTIVE_MODE_OPTIONS) {
    const candidates = [
      option.mode,
      option.label,
      ...(Array.isArray(option.aliases) ? option.aliases : [])
    ];
    if (candidates.some(candidate => String(candidate || '').trim().toLowerCase() && text.includes(String(candidate || '').trim().toLowerCase()))) {
      return option.mode;
    }
  }

  return resolveActiveModeMode(text);
}

function normalizeActiveModeConfig(config = {}) {
  const input = config && typeof config === 'object' ? config : {};
  return {
    mode: normalizeMode(input.mode),
    reference: normalizeStringArray(input.reference),
    company: normalizeStringArray(input.company),
    windowMs: toPositiveInt(input.windowMs, DEFAULT_CONFIG.windowMs),
    minMessages: toPositiveInt(input.minMessages, DEFAULT_CONFIG.minMessages),
    minParticipants: toPositiveInt(input.minParticipants, DEFAULT_CONFIG.minParticipants),
    maxAverageGapMs: toPositiveInt(input.maxAverageGapMs, DEFAULT_CONFIG.maxAverageGapMs),
    maxSpeakerRatio: Number.isFinite(Number(input.maxSpeakerRatio))
      ? Math.max(0.2, Math.min(1, Number(input.maxSpeakerRatio)))
      : DEFAULT_CONFIG.maxSpeakerRatio,
    minBotSilenceMs: toPositiveInt(input.minBotSilenceMs, DEFAULT_CONFIG.minBotSilenceMs),
    cooldownMs: toPositiveInt(input.cooldownMs, DEFAULT_CONFIG.cooldownMs),
    maxPromptMessages: toPositiveInt(input.maxPromptMessages, DEFAULT_CONFIG.maxPromptMessages),
    includeRooms: normalizeStringArray(input.includeRooms),
    excludeRooms: normalizeStringArray(input.excludeRooms),
    shouldIntervene: typeof input.shouldIntervene === 'function' ? input.shouldIntervene : null
  };
}

function isMeaningfulMessage(message = {}) {
  const content = sanitizeMessageContent(message.content || '');
  return content.length >= 2;
}

function sanitizeMessageContent(value = '') {
  return String(value || '')
    .replace(/<img\b[^>]*>/giu, ' ')
    .replace(/<json\b[^>]*>/giu, ' ')
    .replace(/<at\b[^>]*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function countUniqueUsers(messages = []) {
  return new Set(
    messages
      .map(item => normalizeText(item.userId || item.username || '', 80))
      .filter(Boolean)
  ).size;
}

function computeTopSpeakerRatio(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 1;
  }

  const counts = new Map();
  for (const message of messages) {
    const key = normalizeText(message.userId || message.username || '', 80) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const top = Math.max(...counts.values());
  return top / messages.length;
}

function computeAverageGapMs(messages = []) {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return Infinity;
  }

  let gapSum = 0;
  let pairs = 0;
  for (let index = 1; index < messages.length; index += 1) {
    const prev = normalizeEpochTimestamp(messages[index - 1]?.timestamp);
    const next = normalizeEpochTimestamp(messages[index]?.timestamp);
    if (next <= prev) continue;
    gapSum += next - prev;
    pairs += 1;
  }

  return pairs > 0 ? Math.round(gapSum / pairs) : Infinity;
}

function detectReason(messages = []) {
  const joined = messages
    .map(item => sanitizeMessageContent(item.content || ''))
    .filter(Boolean)
    .join('\n');

  if (/\bBGM\b|点歌|歌单|音乐|副歌|旋律|歌词/u.test(joined)) {
    return 'music';
  }
  if (/急|吵|别喷|打拳|上头|坐死了|快跑/u.test(joined)) {
    return 'tension';
  }

  const questionCount = messages.filter((message) => {
    const content = sanitizeMessageContent(message.content || '');
    return /\?|？|吗$|咋|怎么|为什么|谁/u.test(content);
  }).length;

  if (questionCount >= 2) {
    return 'question';
  }

  return 'generic';
}

function buildSnapshot(messages = [], config = {}) {
  const meaningfulMessages = messages.filter(isMeaningfulMessage);
  const participantCount = countUniqueUsers(meaningfulMessages);
  const topSpeakerRatio = computeTopSpeakerRatio(meaningfulMessages);
  const averageGapMs = computeAverageGapMs(meaningfulMessages);
  const reason = detectReason(meaningfulMessages);

  return {
    messages: meaningfulMessages,
    messageCount: meaningfulMessages.length,
    participantCount,
    topSpeakerRatio,
    averageGapMs,
    reason,
    mode: config.mode || DEFAULT_CONFIG.mode
  };
}

function shouldInterveneWithBuiltins(snapshot = {}, config = {}) {
  const baseMinMessages = toPositiveInt(config.minMessages, DEFAULT_CONFIG.minMessages);
  const baseMinParticipants = toPositiveInt(config.minParticipants, DEFAULT_CONFIG.minParticipants);
  const baseMaxAverageGapMs = toPositiveInt(config.maxAverageGapMs, DEFAULT_CONFIG.maxAverageGapMs);
  const baseMaxSpeakerRatio = Number(config.maxSpeakerRatio ?? DEFAULT_CONFIG.maxSpeakerRatio);
  const reason = normalizeText(snapshot.reason, 24);

  let minMessages = baseMinMessages;
  let minParticipants = baseMinParticipants;
  let maxAverageGapMs = baseMaxAverageGapMs;
  let maxSpeakerRatio = baseMaxSpeakerRatio;

  if (reason === 'question') {
    minMessages = Math.max(2, baseMinMessages - 1);
    minParticipants = Math.max(2, baseMinParticipants);
    maxAverageGapMs = Math.round(baseMaxAverageGapMs * 1.2);
  } else if (reason === 'tension') {
    minMessages = Math.max(2, baseMinMessages - 2);
    minParticipants = Math.max(2, baseMinParticipants - 1);
    maxAverageGapMs = Math.round(baseMaxAverageGapMs * 1.4);
    maxSpeakerRatio = Math.min(1, baseMaxSpeakerRatio + 0.15);
  }

  if (snapshot.messageCount < minMessages) {
    return false;
  }
  if (snapshot.participantCount < minParticipants) {
    return false;
  }
  if (snapshot.averageGapMs > maxAverageGapMs) {
    return false;
  }
  if (snapshot.topSpeakerRatio > maxSpeakerRatio) {
    return false;
  }
  return true;
}

function createStatusText(status = {}, config = {}) {
  const updatedAt = Number.isFinite(Number(status.updatedAt)) && status.updatedAt > 0
    ? new Date(status.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '未设置';
  const lastInterventionAt = Number.isFinite(Number(status.lastInterventionAt)) && status.lastInterventionAt > 0
    ? new Date(status.lastInterventionAt).toLocaleString('zh-CN', { hour12: false })
    : '暂无';
  const reference = Array.isArray(config.reference) && config.reference.length > 0
    ? config.reference.join('、')
    : '无';
  const company = Array.isArray(config.company) && config.company.length > 0
    ? `${config.company.length} 人`
    : '无';
  const activeMode = describeActiveMode(status.mode);
  const modeList = ACTIVE_MODE_OPTIONS
    .map(item => `- ${item.label}：${item.description}`)
    .join('\n');

  return [
    '主动模式状态',
    `当前主动模式: ${activeMode.label}`,
    '主动模式列表:',
    modeList,
    `响应关键词: ${reference}`,
    `陪伴列表: ${company}`,
    `最近一次介入: ${lastInterventionAt}`,
    `最近变更: ${updatedAt}`,
    `触发阈值: ${config.minMessages} 条消息 / ${config.minParticipants} 人 / ${Math.round(config.windowMs / 1000)} 秒窗口`,
    `冷却时间: ${Math.round(config.cooldownMs / 1000)} 秒`
  ].join('\n');
}

function createModeListText() {
  return ACTIVE_MODE_OPTIONS
    .map(item => `- ${item.label}：${item.description}`)
    .join('\n');
}

function createModeHelpText(status = {}, config = {}) {
  const activeMode = describeActiveMode(status.mode);
  return [
    `当前主动模式: ${activeMode.label}`,
    '主动模式列表:',
    createModeListText(),
    `响应关键词: ${Array.isArray(config.reference) && config.reference.length > 0 ? config.reference.join('、') : '无'}`,
    `陪伴列表: ${Array.isArray(config.company) && config.company.length > 0 ? config.company.join('、') : '无'}`
  ].join('\n');
}

function toPromptContextMessage(message = {}) {
  const content = sanitizeMessageContent(message.content || '');
  const rawContent = normalizeText(message.rawContent || message.content || '', 240);
  if (!content && !rawContent) {
    return null;
  }

  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    userId: normalizeText(message.userId || '', 80) || 'unknown',
    username: normalizeText(message.username || '', 80) || '未知用户',
    content,
    rawContent: rawContent || content,
    isMentionBot: message.isMentionBot === true,
    timestamp: normalizeEpochTimestamp(message.timestamp)
  };
}

function buildProactiveConversationContext(snapshot = {}, maxMessages = DEFAULT_CONFIG.maxPromptMessages) {
  const recentChannelMessages = snapshot.messages
    .slice(-maxMessages)
    .map(toPromptContextMessage)
    .filter(Boolean);
  const currentMessage = recentChannelMessages[recentChannelMessages.length - 1] || {
    role: 'user',
    userId: 'unknown',
    username: '未知用户',
    content: '',
    rawContent: '',
    isMentionBot: false,
    timestamp: Date.now()
  };

  return {
    triggerUser: {
      id: currentMessage.userId,
      name: currentMessage.username
    },
    currentMessage: {
      userId: currentMessage.userId,
      username: currentMessage.username,
      content: currentMessage.content,
      rawContent: currentMessage.rawContent,
      timestamp: currentMessage.timestamp
    },
    recentMessages: [],
    channelRecentMessages: recentChannelMessages,
    historySummary: [],
    anchorCount: 0
  };
}

function buildProactiveTrigger(session, snapshot = {}, activeMode = {}) {
  const currentMessage = toPromptContextMessage(snapshot.messages[snapshot.messages.length - 1] || {}) || {
    role: 'user',
    userId: normalizeText(session?.userId || '', 80) || 'unknown',
    username: normalizeText(session?.username || '', 80) || '未知用户',
    content: sanitizeMessageContent(session?.content || ''),
    rawContent: normalizeText(session?.content || '', 240),
    isMentionBot: false,
    timestamp: normalizeEpochTimestamp(extractSessionTimestamp(session))
  };
  const channelId = normalizeText(snapshot.roomId || session?.channelId || session?.chatId || '', 160);

  return {
    kind: 'message.proactive',
    isPrivateSession: false,
    userId: currentMessage.userId,
    username: currentMessage.username,
    channelId,
    messageId: normalizeText(session?.messageId || '', 80) || `proactive-${Date.now()}`,
    timestamp: currentMessage.timestamp,
    rawContent: currentMessage.rawContent || currentMessage.content,
    cleanedContent: currentMessage.content,
    content: currentMessage.content,
    mode: activeMode.mode || DEFAULT_CONFIG.mode
  };
}

function didChatEmitOutput(result = {}) {
  if (!result || typeof result !== 'object') {
    return false;
  }

  if (result.mode === 'direct-tool') {
    return Array.isArray(result.outputResults) && result.outputResults.length > 0;
  }

  const workflowResult = result.workflowResult;
  if (!workflowResult || typeof workflowResult !== 'object') {
    return false;
  }

  return Boolean(workflowResult.outputResult)
    || (Array.isArray(workflowResult.finalOutputResults) && workflowResult.finalOutputResults.length > 0)
    || (Array.isArray(workflowResult.outputResults) && workflowResult.outputResults.length > 0);
}

function createActiveModeService(options = {}) {
  const config = normalizeActiveModeConfig(options.config || {});
  const logger = options.logger || console;
  const router = options.router || new TriggerRouter({
    botProfile: options.botProfile || {},
    adminUids: Array.isArray(options.adminUids) ? options.adminUids : [],
    referenceKeywords: config.reference
  });
  const state = {
    pendingTasks: new Set(),
    roomStates: new Map()
  };

  function getRoomState(roomId) {
    const key = normalizeText(roomId, 160);
    if (!state.roomStates.has(key)) {
      state.roomStates.set(key, {
        inFlight: false,
        lastInterventionAt: 0
      });
    }
    return state.roomStates.get(key);
  }

  function getStatus() {
    const lastInterventionAt = Math.max(
      0,
      ...Array.from(state.roomStates.values()).map(item => Number(item.lastInterventionAt || 0))
    );
    return {
      ...config,
      lastInterventionAt
    };
  }

  function setMode(nextMode = '') {
    const normalizedMode = normalizeMode(nextMode);
    config.mode = normalizedMode;
    config.updatedAt = Date.now();
    return getStatus();
  }

  function getModeList() {
    return ACTIVE_MODE_OPTIONS.map(item => ({ ...item }));
  }

  async function maybeIntervene(session, context = {}) {
    const triggerRouter = context.router || router;
    const trigger = triggerRouter.routeMessage(session);
    if (trigger.blockedReason) return false;
    if (trigger.isPrivateSession || trigger.isMentioned) return false;
    if (config.mode === 'none') return false;

    const roomId = normalizeText(trigger.channelId, 160);
    if (!roomId) return false;
    if (config.includeRooms.length > 0 && !config.includeRooms.includes(roomId)) return false;
    if (config.excludeRooms.includes(roomId)) return false;

    const roomState = getRoomState(roomId);
    if (roomState.inFlight) return false;

    const now = normalizeEpochTimestamp(extractSessionTimestamp(session));
    if (roomState.lastInterventionAt > 0 && now - roomState.lastInterventionAt < config.cooldownMs) {
      return false;
    }

    const contextService = context.contextService;
    if (!contextService || typeof contextService.getMessagesInWindow !== 'function') {
      return false;
    }

    const recentUserMessages = await Promise.resolve(
      contextService.getMessagesInWindow(roomId, now - config.windowMs, now + 1, { roles: ['user'] })
    );

    if (config.mode === 'companion') {
      if (config.company.length === 0) {
        return false;
      }

      const companySet = new Set(config.company.map(item => normalizeText(item, 80)));
      const hasCompanyParticipant = Array.isArray(recentUserMessages)
        && recentUserMessages.some(item => companySet.has(normalizeText(item.userId || item.username || '', 80)));
      if (!hasCompanyParticipant) {
        return false;
      }
    }

    const recentAssistantMessages = config.minBotSilenceMs > 0
      ? await Promise.resolve(
          contextService.getMessagesInWindow(roomId, now - config.minBotSilenceMs, now + 1, { roles: ['assistant'] })
        )
      : [];

    if (Array.isArray(recentAssistantMessages) && recentAssistantMessages.length > 0) {
      return false;
    }

    if (Array.isArray(recentUserMessages) && recentUserMessages.some(item => item.isMentionBot === true)) {
      return false;
    }

    const snapshot = buildSnapshot(
      Array.isArray(recentUserMessages) ? recentUserMessages : [],
      config
    );
    snapshot.roomId = roomId;

    let shouldIntervene = shouldInterveneWithBuiltins(snapshot, config);
    if (shouldIntervene && typeof config.shouldIntervene === 'function') {
      const customDecision = await config.shouldIntervene(snapshot, {
        session,
        roomId,
        contextService,
        config
      });
      if (typeof customDecision === 'boolean') {
        shouldIntervene = customDecision;
      }
    }

    if (!shouldIntervene) {
      return false;
    }

    roomState.inFlight = true;
    try {
      if (!context.workflowRuntime || !context.toolRegistry || !context.outputRuntime) {
        return false;
      }

      const proactiveTrigger = buildProactiveTrigger(session, snapshot, config);
      const proactiveTemplate = context.triggerTemplateRegistry?.get?.('message.proactive') || null;
      const conversationContext = buildProactiveConversationContext(snapshot, config.maxPromptMessages);
      const result = await invokeWorkflowChat({
        trigger: proactiveTrigger,
        session,
        ctx: context.ctx,
        botProfile: context.botProfile,
        skillManager: context.skillManager,
        toolRegistry: context.toolRegistry,
        workflowRuntime: context.workflowRuntime,
        outputRuntime: context.outputRuntime,
        pickFallback: context.pickFallback,
        contextService: context.contextService,
        template: proactiveTemplate,
        availableTools: context.triggerTemplateRegistry?.resolveTools?.(context.toolRegistry, 'message.proactive')
          || context.toolRegistry.list({ workflowVisibleOnly: true }),
        conversationContext,
        sendOptions: {
          recordConversation: false
        },
        runtimeConfig: context.runtimeConfig || context.config || {},
        resultMode: 'workflow-proactive',
        triggerPayload: {
          proactive: true,
          mode: config.mode,
          modeLabel: describeActiveMode(config.mode).label,
          reason: snapshot.reason || 'generic',
          roomId,
          messageCount: snapshot.messageCount,
          participantCount: snapshot.participantCount,
          averageGapMs: snapshot.averageGapMs,
          topSpeakerRatio: snapshot.topSpeakerRatio
        }
      });

      if (!didChatEmitOutput(result)) {
        return false;
      }

      roomState.lastInterventionAt = now;
      return true;
    } finally {
      roomState.inFlight = false;
    }
  }

  function scheduleMessageEvaluation(session, context = {}) {
    if (config.mode === 'none') {
      return Promise.resolve(false);
    }

    const task = new Promise((resolve) => {
      setTimeout(resolve, 0);
    })
      .then(() => maybeIntervene(session, context))
      .catch((error) => {
        logger.warn?.(`[active-mode] message evaluation failed: ${error.message}`);
        return false;
      })
      .finally(() => {
        state.pendingTasks.delete(task);
      });

    state.pendingTasks.add(task);
    return task;
  }

  return {
    getStatus,
    setMode,
    getModeList,
    createModeListText,
    createModeHelpText,
    createStatusText() {
      return createStatusText(getStatus(), config);
    },
    async awaitIdle() {
      await Promise.allSettled(Array.from(state.pendingTasks));
    },
    scheduleMessageEvaluation,
    config: {
      ...config
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  MODE_LABELS,
  ACTIVE_MODE_OPTIONS,
  buildSnapshot,
  createActiveModeService,
  createStatusText,
  describeActiveMode,
  normalizeActiveModeConfig,
  normalizeMode,
  resolveActiveModeMode,
  resolveRequestedActiveMode,
  shouldInterveneWithBuiltins
};
