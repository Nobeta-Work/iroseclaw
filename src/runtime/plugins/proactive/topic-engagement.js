/**
 * Proactive topic engagement plugin
 * 在高频群聊时以轻量、低打断方式自然介入话题。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');
const { TriggerRouter, extractSessionTimestamp } = require('../../trigger/router');

const DEFAULT_SETTINGS = {
  enabled: false,
  modeName: '轻介入模式',
  updatedAt: 0
};

const DEFAULT_CONFIG = {
  dataDir: path.join(process.cwd(), 'data', 'proactive-topic-engagement'),
  settingsFile: 'settings.json',
  defaultEnabled: false,
  defaultModeName: DEFAULT_SETTINGS.modeName,
  windowMs: 45000,
  minMessages: 4,
  minParticipants: 2,
  maxAverageGapMs: 18000,
  maxSpeakerRatio: 0.75,
  minBotSilenceMs: 45000,
  cooldownMs: 3 * 60 * 1000,
  maxPromptMessages: 10,
  providerTimeoutMs: 10000,
  provider: null,
  includeRooms: [],
  excludeRooms: [],
  shouldIntervene: null,
  composeIntervention: null
};

const QUESTION_PATTERNS = [/\?/u, /？/u, /吗$/u, /咋/u, /怎么/u, /为什么/u, /谁/u];
const TENSION_PATTERNS = [/急/u, /吵/u, /别喷/u, /打拳/u, /上头/u, /坐死了/u, /快跑/u];
const MUSIC_PATTERNS = [/点歌/u, /歌/u, /副歌/u, /旋律/u, /歌词/u, /BGM/u, /音乐/u];

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

function normalizeModeName(value, fallback = DEFAULT_SETTINGS.modeName) {
  const text = normalizeText(value, 24);
  return text || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => normalizeText(item, 160))
      .filter(Boolean)
  )];
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

function sanitizeMessageContent(value = '') {
  return String(value || '')
    .replace(/<img\b[^>]*>/giu, ' ')
    .replace(/<json\b[^>]*>/giu, ' ')
    .replace(/<at\b[^>]*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isMeaningfulMessage(message = {}) {
  const content = sanitizeMessageContent(message.content || '');
  return content.length >= 2;
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

  if (MUSIC_PATTERNS.some(pattern => pattern.test(joined))) {
    return 'music';
  }
  if (TENSION_PATTERNS.some(pattern => pattern.test(joined))) {
    return 'tension';
  }

  const questionCount = messages.filter((message) => {
    const content = sanitizeMessageContent(message.content || '');
    return QUESTION_PATTERNS.some(pattern => pattern.test(content));
  }).length;

  if (questionCount >= 2) {
    return 'question';
  }

  return 'generic';
}

function formatPromptMessages(messages = [], maxMessages = 10) {
  return messages
    .slice(-maxMessages)
    .map((message) => {
      const username = normalizeText(message.username || '用户', 40);
      const content = sanitizeMessageContent(message.content || '');
      return content ? `${username}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function sanitizeGeneratedReply(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/\[\[EMO:[^\]]+\]\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
}

function createFallbackReply(snapshot = {}) {
  const reason = snapshot.reason || 'generic';

  if (reason === 'music') {
    return '这波像在拼歌单，下一首想接什么？';
  }
  if (reason === 'tension') {
    return '先别上头，谁来补一句版本答案？';
  }
  if (reason === 'question') {
    return '这段展开有点快，谁来一句话总结？';
  }
  return '你们这段聊得挺快，谁来补一句前情提要？';
}

function mergeSettings(defaults, persisted, overrides = {}) {
  return {
    enabled: overrides.enabled === true || overrides.enabled === false
      ? overrides.enabled
      : (persisted?.enabled === true || persisted?.enabled === false
        ? persisted.enabled
        : defaults.enabled),
    modeName: normalizeModeName(
      overrides.modeName !== undefined ? overrides.modeName : (persisted?.modeName || defaults.modeName),
      defaults.modeName
    ),
    updatedAt: toPositiveInt(
      overrides.updatedAt !== undefined ? overrides.updatedAt : persisted?.updatedAt,
      defaults.updatedAt
    )
  };
}

function createSettingsStore(pluginConfig = {}) {
  const dataDir = path.resolve(pluginConfig.dataDir || DEFAULT_CONFIG.dataDir);
  const settingsPath = path.resolve(dataDir, pluginConfig.settingsFile || DEFAULT_CONFIG.settingsFile);
  const defaults = {
    ...DEFAULT_SETTINGS,
    enabled: pluginConfig.defaultEnabled === true,
    modeName: normalizeModeName(pluginConfig.defaultModeName, DEFAULT_SETTINGS.modeName)
  };
  const persisted = readJsonFile(settingsPath, null);
  let settings = mergeSettings(defaults, persisted);

  return {
    get() {
      return { ...settings };
    },
    save(patch = {}) {
      settings = mergeSettings(defaults, settings, {
        ...patch,
        updatedAt: Date.now()
      });
      writeJsonFile(settingsPath, settings);
      return this.get();
    },
    paths: {
      dataDir,
      settingsPath
    }
  };
}

function resolveProviderFactory(host, context, pluginConfig = {}) {
  let cachedProvider;
  let resolved = false;

  return function resolveProvider() {
    if (resolved) return cachedProvider;
    resolved = true;

    if (pluginConfig.provider === false) {
      cachedProvider = null;
      return cachedProvider;
    }

    if (pluginConfig.provider && typeof pluginConfig.provider.complete === 'function') {
      cachedProvider = pluginConfig.provider;
      return cachedProvider;
    }

    const config = context.config || {};
    const logger = context.logger || host.logger || console;
    const directProvider = config.workflow?.provider;
    if (directProvider && typeof directProvider.complete === 'function') {
      cachedProvider = directProvider;
      return cachedProvider;
    }

    if (typeof config.workflow?.providerFactory === 'function') {
      const provider = config.workflow.providerFactory({
        config,
        logger,
        ctx: context.ctx || null,
        host
      });
      if (provider && typeof provider.complete === 'function') {
        cachedProvider = provider;
        return cachedProvider;
      }
    }

    const providerName = typeof pluginConfig.provider === 'string' && pluginConfig.provider.trim()
      ? pluginConfig.provider.trim().toLowerCase()
      : (typeof config.workflow?.provider === 'string' && config.workflow.provider.trim()
        ? config.workflow.provider.trim().toLowerCase()
        : (typeof config.providers?.default === 'string' && config.providers.default.trim()
          ? config.providers.default.trim().toLowerCase()
          : 'openclaw'));

    const registeredProvider = host.getProvider?.(providerName);
    if (!registeredProvider) {
      cachedProvider = null;
      return cachedProvider;
    }

    if (typeof registeredProvider === 'function') {
      const provider = registeredProvider({
        config,
        logger,
        ctx: context.ctx || null,
        host
      });
      cachedProvider = provider && typeof provider.complete === 'function' ? provider : null;
      return cachedProvider;
    }

    cachedProvider = typeof registeredProvider.complete === 'function' ? registeredProvider : null;
    return cachedProvider;
  };
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
    modeName: normalizeModeName(config.modeName, DEFAULT_SETTINGS.modeName)
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

  // Question/tension rooms benefit from earlier lightweight intervention.
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

async function composeInterventionText(snapshot = {}, options = {}) {
  const customComposer = typeof options.composeIntervention === 'function'
    ? options.composeIntervention
    : null;
  if (customComposer) {
    const customText = await customComposer(snapshot, options);
    const sanitizedCustom = sanitizeGeneratedReply(customText);
    if (sanitizedCustom) {
      return sanitizedCustom;
    }
  }

  const provider = typeof options.resolveProvider === 'function'
    ? options.resolveProvider()
    : null;
  if (provider && typeof provider.complete === 'function') {
    const prompt = [
      '你在一个热闹群聊里以机器人身份轻轻插一句话。',
      '只生成一句自然中文，不超过28个汉字。',
      '不要自我介绍，不要说“作为机器人”，不要解释规则，不要连续追问。',
      '要像顺着话题轻轻接梗或帮忙收束，不要抢戏。',
      `当前模式名：${snapshot.modeName || DEFAULT_SETTINGS.modeName}`,
      `当前判断：${snapshot.reason || 'generic'}`,
      '最近消息：',
      formatPromptMessages(snapshot.messages, options.maxPromptMessages || DEFAULT_CONFIG.maxPromptMessages)
    ].join('\n');

    try {
      const result = await provider.complete({
        message: prompt,
        timeoutMs: toPositiveInt(options.providerTimeoutMs, DEFAULT_CONFIG.providerTimeoutMs),
        sessionId: `topic-engagement-${snapshot.roomId || 'room'}`,
        json: false
      });
      const generated = sanitizeGeneratedReply(result?.text || result?.plainText || result?.jsonText || '');
      if (generated) {
        return generated;
      }
    } catch (error) {
      options.logger?.warn?.(`[topic-engagement] provider compose failed: ${error.message}`);
    }
  }

  return createFallbackReply(snapshot);
}

function createStatusText(status = {}, config = {}) {
  const updatedAt = Number.isFinite(Number(status.updatedAt)) && status.updatedAt > 0
    ? new Date(status.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '未设置';
  const lastInterventionAt = Number.isFinite(Number(status.lastInterventionAt)) && status.lastInterventionAt > 0
    ? new Date(status.lastInterventionAt).toLocaleString('zh-CN', { hour12: false })
    : '暂无';

  return [
    '主动话题介入状态',
    `模式名: ${status.modeName || DEFAULT_SETTINGS.modeName}`,
    `开关: ${status.enabled ? '已开启' : '已关闭'}`,
    `最近一次介入: ${lastInterventionAt}`,
    `最近变更: ${updatedAt}`,
    `触发阈值: ${config.minMessages} 条消息 / ${config.minParticipants} 人 / ${Math.round(config.windowMs / 1000)} 秒窗口`,
    `冷却时间: ${Math.round(config.cooldownMs / 1000)} 秒`
  ].join('\n');
}

function createTopicEngagementService(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options.config
  };
  config.includeRooms = normalizeStringArray(config.includeRooms);
  config.excludeRooms = normalizeStringArray(config.excludeRooms);
  config.windowMs = toPositiveInt(config.windowMs, DEFAULT_CONFIG.windowMs);
  config.minMessages = toPositiveInt(config.minMessages, DEFAULT_CONFIG.minMessages);
  config.minParticipants = toPositiveInt(config.minParticipants, DEFAULT_CONFIG.minParticipants);
  config.maxAverageGapMs = toPositiveInt(config.maxAverageGapMs, DEFAULT_CONFIG.maxAverageGapMs);
  config.minBotSilenceMs = toPositiveInt(config.minBotSilenceMs, DEFAULT_CONFIG.minBotSilenceMs);
  config.cooldownMs = toPositiveInt(config.cooldownMs, DEFAULT_CONFIG.cooldownMs);
  config.maxPromptMessages = toPositiveInt(config.maxPromptMessages, DEFAULT_CONFIG.maxPromptMessages);
  config.providerTimeoutMs = toPositiveInt(config.providerTimeoutMs, DEFAULT_CONFIG.providerTimeoutMs);
  config.maxSpeakerRatio = Number.isFinite(Number(config.maxSpeakerRatio))
    ? Math.max(0.2, Math.min(1, Number(config.maxSpeakerRatio)))
    : DEFAULT_CONFIG.maxSpeakerRatio;

  const logger = options.logger || console;
  const settingsStore = options.settingsStore;
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
    const settings = settingsStore.get();
    const lastInterventionAt = Math.max(
      0,
      ...Array.from(state.roomStates.values()).map(item => Number(item.lastInterventionAt || 0))
    );
    return {
      ...settings,
      lastInterventionAt
    };
  }

  async function updateSettings(patch = {}) {
    return settingsStore.save(patch);
  }

  async function maybeIntervene(session, context = {}) {
    const router = context.router;
    const trigger = router.routeMessage(session);
    if (trigger.blockedReason) return false;
    if (trigger.isPrivateSession || trigger.isMentioned) return false;
    if (normalizeText(trigger.userId, 80) === normalizeText(context.botProfile?.uid, 80)) return false;

    const roomId = normalizeText(trigger.channelId, 160);
    if (!roomId) return false;
    if (config.includeRooms.length > 0 && !config.includeRooms.includes(roomId)) return false;
    if (config.excludeRooms.includes(roomId)) return false;

    const settings = settingsStore.get();
    if (settings.enabled !== true) return false;

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
      {
        ...config,
        modeName: settings.modeName
      }
    );
    snapshot.roomId = roomId;

    let shouldIntervene = shouldInterveneWithBuiltins(snapshot, config);
    if (shouldIntervene && typeof config.shouldIntervene === 'function') {
      const customDecision = await config.shouldIntervene(snapshot, {
        session,
        roomId,
        settings,
        contextService
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
      const text = await composeInterventionText(snapshot, {
        composeIntervention: config.composeIntervention,
        resolveProvider: options.resolveProvider,
        providerTimeoutMs: config.providerTimeoutMs,
        maxPromptMessages: config.maxPromptMessages,
        logger
      });
      if (!text) {
        return false;
      }

      const outputRuntime = context.outputRuntime;
      if (!outputRuntime || typeof outputRuntime.execute !== 'function') {
        return false;
      }

      await outputRuntime.execute({
        kind: 'reply.current',
        content: {
          text,
          useMemePipeline: false
        }
      }, {
        session,
        ctx: context.ctx,
        userId: 'system:topic-engagement',
        username: 'TopicEngagement',
        sendOptions: {
          conversationStore: context.contextService,
          botProfile: context.botProfile
        }
      });

      roomState.lastInterventionAt = now;
      return true;
    } finally {
      roomState.inFlight = false;
    }
  }

  function scheduleMessageEvaluation(session, context = {}) {
    const task = new Promise((resolve) => {
      setTimeout(resolve, 0);
    })
      .then(() => maybeIntervene(session, context))
      .catch((error) => {
        logger.warn?.(`[topic-engagement] message evaluation failed: ${error.message}`);
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
    async enable(modeName = '') {
      const patch = { enabled: true };
      if (normalizeText(modeName, 24)) {
        patch.modeName = normalizeModeName(modeName, settingsStore.get().modeName);
      }
      return updateSettings(patch);
    },
    async disable() {
      return updateSettings({ enabled: false });
    },
    async rename(modeName = '') {
      const normalizedName = normalizeModeName(modeName, '');
      if (!normalizedName) {
        throw new Error('请提供模式名称。');
      }
      return updateSettings({ modeName: normalizedName });
    },
    async awaitIdle() {
      await Promise.allSettled(Array.from(state.pendingTasks));
    },
    scheduleMessageEvaluation,
    createStatusText() {
      return createStatusText(getStatus(), config);
    },
    config: {
      ...config
    }
  };
}

function createAdminTool(options = {}) {
  const {
    name,
    description,
    aliases = [],
    directAliases = [],
    service,
    config,
    handler
  } = options;

  return {
    name,
    description,
    aliases: [...aliases],
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
    permission: ['admin'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 5000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: [...directAliases],
      workflowVisible: true,
      helpVisible: false,
      adminOnly: true
    },
    async execute(context = {}, input = {}) {
      const userId = context.session?.user?.id || context.session?.userId || context.userId || '';
      if (!isAdminUser(config, userId)) {
        return createToolResult({
          ok: false,
          name,
          error: '权限不足：此功能仅限管理员使用'
        });
      }

      try {
        const result = await handler({
          input,
          service,
          context
        });
        const text = typeof result === 'string' ? result : String(result ?? '');
        return createToolResult({
          ok: true,
          name,
          result: text,
          summary: text.slice(0, 120)
        });
      } catch (error) {
        return createToolResult({
          ok: false,
          name,
          error: error.message
        });
      }
    }
  };
}

module.exports = {
  name: 'proactive-topic-engagement',
  apply(host, context) {
    const scopedConfig = context.getPluginConfig({});
    const settingsStore = createSettingsStore({
      ...DEFAULT_CONFIG,
      ...scopedConfig
    });
    const resolveProvider = resolveProviderFactory(host, context, scopedConfig);
    const router = new TriggerRouter({
      botProfile: context.config?.bot || {},
      adminUids: Array.isArray(context.config?.admins) ? context.config.admins : []
    });
    const service = createTopicEngagementService({
      config: {
        ...DEFAULT_CONFIG,
        ...scopedConfig,
        defaultEnabled: scopedConfig.defaultEnabled === true || settingsStore.get().enabled === true,
        defaultModeName: scopedConfig.defaultModeName || settingsStore.get().modeName
      },
      settingsStore,
      resolveProvider,
      logger: context.logger || host.logger || console
    });

    host.registerService('proactive.topic-engagement', service);

    const cleanup = context.ctx?.on?.('message', (session) => {
      service.scheduleMessageEvaluation(session, {
        ctx: context.ctx,
        contextService: context.contextService,
        outputRuntime: context.outputRuntime,
        botProfile: context.config?.bot || {},
        router
      });
    });
    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    context.registerToolPackage({
      name: 'proactive-topic-engagement-package',
      version: '0.1.0',
      tools: [
        createAdminTool({
          name: 'proactive.topic.enable',
          description: '开启高频群聊下的主动话题介入模式。',
          aliases: ['开启主动模式', '开启主动介入', '打开主动模式'],
          directAliases: ['开启主动模式', '开启主动介入', '打开主动模式'],
          service,
          config: context.config,
          handler: async ({ input, service: svc }) => {
            const modeName = normalizeText(input.query || input.raw || '', 24);
            const settings = await svc.enable(modeName);
            return `已开启主动话题介入。\n当前模式名: ${settings.modeName}`;
          }
        }),
        createAdminTool({
          name: 'proactive.topic.disable',
          description: '关闭主动话题介入模式。',
          aliases: ['关闭主动模式', '关闭主动介入', '停止主动介入'],
          directAliases: ['关闭主动模式', '关闭主动介入', '停止主动介入'],
          service,
          config: context.config,
          handler: async ({ service: svc }) => {
            const settings = await svc.disable();
            return `已关闭主动话题介入。\n当前模式名: ${settings.modeName}`;
          }
        }),
        createAdminTool({
          name: 'proactive.topic.status',
          description: '查看主动话题介入模式状态。',
          aliases: ['主动模式状态', '主动介入状态', '查看主动模式状态'],
          directAliases: ['主动模式状态', '主动介入状态', '查看主动模式状态'],
          service,
          config: context.config,
          handler: ({ service: svc }) => svc.createStatusText()
        }),
        createAdminTool({
          name: 'proactive.topic.rename',
          description: '为主动话题介入模式命名。',
          aliases: ['命名主动模式', '设置主动模式名', '主动模式命名'],
          directAliases: ['命名主动模式', '设置主动模式名', '主动模式命名'],
          service,
          config: context.config,
          handler: async ({ input, service: svc }) => {
            const modeName = normalizeText(input.query || input.raw || '', 24);
            if (!modeName) {
              throw new Error('请在命令后提供模式名，例如：命名主动模式 茶水间模式');
            }
            const settings = await svc.rename(modeName);
            return `主动话题介入模式已命名为：${settings.modeName}`;
          }
        })
      ],
      triggerTemplates: [
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'proactive.topic.enable',
              'proactive.topic.disable',
              'proactive.topic.status',
              'proactive.topic.rename'
            ],
            instruction: '管理员私聊时，可开启、关闭、查看或命名主动话题介入模式。'
          }
        }
      ],
      metadata: {
        pluginName: 'proactive-topic-engagement',
        adminOnly: true,
        description: '基于群聊高频对话的轻量主动介入插件'
      }
    });

    host.logger?.INFO?.('PROACTIVE', 'Proactive topic engagement plugin loaded');
  }
};
