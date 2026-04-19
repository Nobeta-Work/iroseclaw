/**
 * Runtime config loader
 * 统一配置入口，兼容新旧配置文件并支持环境变量覆盖
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');

const CONFIG_PATHS = {
  app: path.join(CONFIG_DIR, 'app.json')
};

const ENV_KEYS = [
  'IROSE_BOT_UID',
  'IROSE_BOT_NAME',
  'IROSE_BOT_PLATFORM',
  'IROSE_ROOM_ID',
  'IROSE_ADMINS',
  'IROSE_RUNTIME_MODE',
  'IROSE_OPENCLAW_AGENT',
  'IROSE_OPENCLAW_SUBAGENT',
  'IROSE_OPENCLAW_TIMEOUT',
  'IROSE_MEME_ENABLED',
  'IROSE_MEME_TRIGGER_PROBABILITY',
  'IROSE_MEME_REQUEST_EMOTION_TAG',
  'IROSE_RATE_LIMIT_PER_MINUTE',
  'IROSE_IIROSE_USERNAME',
  'IROSE_IIROSE_PASSWORD'
];

const DEFAULT_CONFIG = {
  bot: {
    uid: '',
    name: 'IIROSE Claw',
    platform: 'iirose'
  },
  roomId: '',
  auth: {
    iiroseUsername: '',
    iirosePassword: ''
  },
  admins: [],
  permissions: {
    default: {
      allowedActions: ['chat', 'help', 'music'],
      blockedActions: ['admin', 'system', 'config']
    },
    admin: {
      allowedActions: ['chat', 'help', 'music', 'admin', 'system', 'config', 'message.route'],
      blockedActions: []
    }
  },
  runtime: {
    mode: 'workflow',
    eventTriggersEnabled: false
  },
  workflow: {
    planner: 'llm-default',
    maxSteps: 6,
    maxToolCallsPerStep: 4,
    allowParallelReadTools: true,
    maxProviderRetries: 2,
    promptProfile: {
      promptDir: 'prompt',
      activePrompt: '角色',
      activeStyle: 'plain',
      persist: true,
      stateFile: 'data/runtime/workflow-prompt-profile.json',
      botProfile: {
        name: 'IIROSE Claw',
        identity: '你是一个在 IIROSE 房间中协助聊天与工具编排的机器人助手。',
        extraInstruction: ''
      },
      memory: {
        maxEntries: 50
      },
      styles: {
        plain: {
          label: '平淡',
          instruction: '语气自然、克制、直接，不刻意卖萌，不夸张，不撒娇。',
          aliases: ['平淡', '普通', 'normal', 'plain']
        },
        warm: {
          label: '热情',
          instruction: '语气积极、友好、带一点情绪温度，但保持专业和边界。',
          aliases: ['热情', '积极', 'warm', 'enthusiastic']
        },
        affectionate: {
          label: '爱慕',
          instruction: '语气温柔亲近、偏暧昧，但保持安全合规，不进行露骨或越界表达。',
          aliases: ['爱慕', '暧昧', 'romantic', 'affectionate']
        }
      }
    },
    chatOutput: {
      enabled: true,
      splitDelimiter: '/',
      typingDelayPerCharMs: 300,
      maxTypingDelayMs: 5000
    }
  },
  workflowRunLog: {
    enabled: true,
    dataDir: 'data/workflow-runs',
    fileName: 'workflow-runs.jsonl',
    maxBytes: 8388608,
    targetBytesAfterCompact: 6291456,
    compactCheckInterval: 20,
    persist: true
  },
  openclaw: {
    agentLabel: 'iirose-transport',
    subagentLabel: 'iirose-transport',
    timeout: 30000,
    local: true,
    stateless: true,
    useNativeSessionContext: false,
    thinking: '',
    isolatedStatePerRequest: false,
    cleanupStateDirAfterRequest: true,
    stateDirBase: '/tmp/iroseclaw-openclaw',
    configPath: ''
  },
  providers: {
    default: 'openclaw',
    named: {}
  },
  music: {
    playUrlProviders: ['iarcDirect', 'metingRedirect', 'neteaseOuter'],
    providers: {
      customTemplate: {
        enabled: false,
        urlTemplate: ''
      },
      iarcDirect: {
        enabled: true,
        urlTemplate: 'https://v.iarc.top/?type=url&id={{id}}#.mp3'
      },
      metingRedirect: {
        enabled: true,
        endpointTemplate: 'https://api.injahow.cn/meting/?server=netease&type=url&id={{id}}'
      },
      neteaseOuter: {
        enabled: true,
        urlTemplate: 'https://music.163.com/song/media/outer/url?id={{id}}.mp3'
      }
    }
  },
  messageMemory: {
    enabled: true,
    dataDir: 'data/message-memory',
    maxEventsPerChannel: 400,
    recentMessageCount: 30,
    maxAnchorRounds: 20,
    compactCheckInterval: 50,
    compactOnStartup: true,
    maxMessageChars: 180,
    persist: true
  },
  meme: {
    enabled: true,
    triggerProbability: 0.5,
    requestEmotionTag: true
  },
  remotePlugins: {
    entries: [],
    timeout: 10000,
    allowHttp: false
  },
  pluginConfigs: {},
  fallbackResponses: [
    '抱歉，我暂时无法处理这个请求。',
    '出了点问题，请稍后再试。',
    '我现在有点忙，晚点再聊吧。',
    '这个功能暂时不可用。'
  ],
  rateLimit: {
    perMinute: 60
  },
  policy: {
    allowHighRiskTools: false,
    allowCrossSessionSend: false,
    maxMessagesPerWorkflow: 3
  }
};

let cachedConfig = null;
let cachedFingerprint = '';

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }
    result[key] = value;
  }
  return result;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`[runtime-config] Failed to parse ${path.basename(filePath)}: ${error.message}`);
    return null;
  }
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePromptStyles(styles = {}, fallbackStyles = {}) {
  const normalized = {};
  const mergedEntries = new Map([
    ...Object.entries(fallbackStyles || {}),
    ...Object.entries(styles || {})
  ]);

  for (const [rawKey, rawStyle] of mergedEntries.entries()) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) continue;
    const style = rawStyle && typeof rawStyle === 'object' && !Array.isArray(rawStyle) ? rawStyle : {};
    const fallback = fallbackStyles[key] && typeof fallbackStyles[key] === 'object' ? fallbackStyles[key] : {};
    const label = typeof style.label === 'string' && style.label.trim()
      ? style.label.trim()
      : (typeof fallback.label === 'string' && fallback.label.trim() ? fallback.label.trim() : key);
    const instruction = typeof style.instruction === 'string' && style.instruction.trim()
      ? style.instruction.trim()
      : (typeof fallback.instruction === 'string' ? fallback.instruction.trim() : '');
    const aliases = Array.from(new Set([
      ...(Array.isArray(fallback.aliases) ? fallback.aliases : []),
      ...(Array.isArray(style.aliases) ? style.aliases : [])
    ]))
      .map(item => String(item || '').trim())
      .filter(Boolean);
    normalized[key] = {
      label,
      instruction,
      aliases
    };
  }

  return normalized;
}

function parseAdmins(adminString) {
  if (!adminString || typeof adminString !== 'string') {
    return null;
  }

  const admins = adminString
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  return admins.length > 0 ? admins : [];
}

function getEnvOverride() {
  const env = process.env;
  const override = {};

  if (env.IROSE_BOT_UID || env.IROSE_BOT_NAME || env.IROSE_BOT_PLATFORM) {
    override.bot = {};
    if (env.IROSE_BOT_UID) override.bot.uid = env.IROSE_BOT_UID;
    if (env.IROSE_BOT_NAME) override.bot.name = env.IROSE_BOT_NAME;
    if (env.IROSE_BOT_PLATFORM) override.bot.platform = env.IROSE_BOT_PLATFORM;
  }

  if (env.IROSE_ROOM_ID) {
    override.roomId = env.IROSE_ROOM_ID;
  }

  const admins = parseAdmins(env.IROSE_ADMINS);
  if (admins) {
    override.admins = admins;
  }

  if (env.IROSE_RUNTIME_MODE) {
    override.runtime = {
      mode: env.IROSE_RUNTIME_MODE
    };
  }

  if (env.IROSE_OPENCLAW_AGENT || env.IROSE_OPENCLAW_SUBAGENT || env.IROSE_OPENCLAW_TIMEOUT) {
    override.openclaw = {};
    if (env.IROSE_OPENCLAW_AGENT) {
      override.openclaw.agentLabel = env.IROSE_OPENCLAW_AGENT;
      // backward compatible mirror
      override.openclaw.subagentLabel = env.IROSE_OPENCLAW_AGENT;
    }
    if (env.IROSE_OPENCLAW_SUBAGENT) {
      override.openclaw.subagentLabel = env.IROSE_OPENCLAW_SUBAGENT;
      if (!env.IROSE_OPENCLAW_AGENT) {
        override.openclaw.agentLabel = env.IROSE_OPENCLAW_SUBAGENT;
      }
    }
    if (env.IROSE_OPENCLAW_TIMEOUT) {
      override.openclaw.timeout = parseInteger(env.IROSE_OPENCLAW_TIMEOUT, DEFAULT_CONFIG.openclaw.timeout);
    }
  }

  if (
    env.IROSE_MEME_ENABLED !== undefined ||
    env.IROSE_MEME_TRIGGER_PROBABILITY !== undefined ||
    env.IROSE_MEME_REQUEST_EMOTION_TAG !== undefined
  ) {
    override.meme = {};

    if (env.IROSE_MEME_ENABLED !== undefined) {
      override.meme.enabled = String(env.IROSE_MEME_ENABLED).toLowerCase() === 'true';
    }

    if (env.IROSE_MEME_TRIGGER_PROBABILITY !== undefined) {
      const probability = Number(env.IROSE_MEME_TRIGGER_PROBABILITY);
      if (Number.isFinite(probability)) {
        override.meme.triggerProbability = probability;
      }
    }

    if (env.IROSE_MEME_REQUEST_EMOTION_TAG !== undefined) {
      override.meme.requestEmotionTag = String(env.IROSE_MEME_REQUEST_EMOTION_TAG).toLowerCase() === 'true';
    }
  }

  if (env.IROSE_RATE_LIMIT_PER_MINUTE) {
    override.rateLimit = {
      perMinute: parseInteger(env.IROSE_RATE_LIMIT_PER_MINUTE, DEFAULT_CONFIG.rateLimit.perMinute)
    };
  }

  if (env.IROSE_IIROSE_USERNAME || env.IROSE_IIROSE_PASSWORD) {
    override.auth = {};
    if (env.IROSE_IIROSE_USERNAME) override.auth.iiroseUsername = env.IROSE_IIROSE_USERNAME;
    if (env.IROSE_IIROSE_PASSWORD) override.auth.iirosePassword = env.IROSE_IIROSE_PASSWORD;
  }

  return override;
}

function normalizeConfig(config) {
  const normalized = deepMerge({}, config || {});
  const allowedRuntimeModes = new Set(['legacy', 'hybrid', 'workflow']);

  // 兼容 bot.roomId -> roomId
  if (!normalized.roomId && normalized.bot && typeof normalized.bot.roomId === 'string') {
    normalized.roomId = normalized.bot.roomId;
  }

  // 兼容 security.admins -> admins
  if ((!normalized.admins || normalized.admins.length === 0) && Array.isArray(normalized.security?.admins)) {
    normalized.admins = normalized.security.admins;
  }

  if (!Array.isArray(normalized.admins)) {
    normalized.admins = [];
  }

  normalized.runtime = normalized.runtime || {};
  const runtimeMode = typeof normalized.runtime.mode === 'string'
    ? normalized.runtime.mode.trim().toLowerCase()
    : '';
  normalized.runtime.mode = allowedRuntimeModes.has(runtimeMode)
    ? runtimeMode
    : DEFAULT_CONFIG.runtime.mode;
  normalized.runtime.eventTriggersEnabled = normalized.runtime.eventTriggersEnabled === true;

  normalized.workflow = normalized.workflow || {};
  if (typeof normalized.workflow.planner === 'string') {
    normalized.workflow.planner = normalized.workflow.planner.trim().toLowerCase() || DEFAULT_CONFIG.workflow.planner;
  } else if (!normalized.workflow.planner && typeof normalized.workflow.plannerFactory !== 'function') {
    normalized.workflow.planner = DEFAULT_CONFIG.workflow.planner;
  }
  normalized.workflow.maxSteps = Math.max(
    1,
    parseInteger(normalized.workflow.maxSteps, DEFAULT_CONFIG.workflow.maxSteps)
  );
  normalized.workflow.maxToolCallsPerStep = Math.max(
    1,
    parseInteger(normalized.workflow.maxToolCallsPerStep, DEFAULT_CONFIG.workflow.maxToolCallsPerStep)
  );
  normalized.workflow.allowParallelReadTools = normalized.workflow.allowParallelReadTools !== false;
  normalized.workflow.maxProviderRetries = Math.max(
    0,
    parseInteger(normalized.workflow.maxProviderRetries, DEFAULT_CONFIG.workflow.maxProviderRetries)
  );
  normalized.workflow.promptProfile =
    normalized.workflow.promptProfile && typeof normalized.workflow.promptProfile === 'object' && !Array.isArray(normalized.workflow.promptProfile)
      ? { ...normalized.workflow.promptProfile }
      : {};
  normalized.workflow.promptProfile.promptDir =
    typeof normalized.workflow.promptProfile.promptDir === 'string' && normalized.workflow.promptProfile.promptDir.trim()
      ? normalized.workflow.promptProfile.promptDir.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.promptDir;
  normalized.workflow.promptProfile.activePrompt =
    typeof normalized.workflow.promptProfile.activePrompt === 'string'
      ? normalized.workflow.promptProfile.activePrompt.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.activePrompt;
  normalized.workflow.promptProfile.persist = normalized.workflow.promptProfile.persist !== false;
  normalized.workflow.promptProfile.stateFile =
    typeof normalized.workflow.promptProfile.stateFile === 'string' && normalized.workflow.promptProfile.stateFile.trim()
      ? normalized.workflow.promptProfile.stateFile.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.stateFile;
  normalized.workflow.promptProfile.botProfile =
    normalized.workflow.promptProfile.botProfile && typeof normalized.workflow.promptProfile.botProfile === 'object' && !Array.isArray(normalized.workflow.promptProfile.botProfile)
      ? { ...normalized.workflow.promptProfile.botProfile }
      : {};
  normalized.workflow.promptProfile.botProfile.name =
    typeof normalized.workflow.promptProfile.botProfile.name === 'string' && normalized.workflow.promptProfile.botProfile.name.trim()
      ? normalized.workflow.promptProfile.botProfile.name.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.botProfile.name;
  normalized.workflow.promptProfile.botProfile.identity =
    typeof normalized.workflow.promptProfile.botProfile.identity === 'string' && normalized.workflow.promptProfile.botProfile.identity.trim()
      ? normalized.workflow.promptProfile.botProfile.identity.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.botProfile.identity;
  normalized.workflow.promptProfile.botProfile.extraInstruction =
    typeof normalized.workflow.promptProfile.botProfile.extraInstruction === 'string'
      ? normalized.workflow.promptProfile.botProfile.extraInstruction.trim()
      : DEFAULT_CONFIG.workflow.promptProfile.botProfile.extraInstruction;
  normalized.workflow.promptProfile.styles = normalizePromptStyles(
    normalized.workflow.promptProfile.styles,
    DEFAULT_CONFIG.workflow.promptProfile.styles
  );
  normalized.workflow.promptProfile.activeStyle =
    typeof normalized.workflow.promptProfile.activeStyle === 'string' && normalized.workflow.promptProfile.activeStyle.trim()
      ? normalized.workflow.promptProfile.activeStyle.trim().toLowerCase()
      : DEFAULT_CONFIG.workflow.promptProfile.activeStyle;
  if (!normalized.workflow.promptProfile.styles[normalized.workflow.promptProfile.activeStyle]) {
    normalized.workflow.promptProfile.activeStyle = DEFAULT_CONFIG.workflow.promptProfile.activeStyle;
  }
  normalized.workflow.promptProfile.memory =
    normalized.workflow.promptProfile.memory && typeof normalized.workflow.promptProfile.memory === 'object' && !Array.isArray(normalized.workflow.promptProfile.memory)
      ? { ...normalized.workflow.promptProfile.memory }
      : {};
  normalized.workflow.promptProfile.memory.maxEntries = Math.max(
    1,
    parseInteger(normalized.workflow.promptProfile.memory.maxEntries, DEFAULT_CONFIG.workflow.promptProfile.memory.maxEntries)
  );
  normalized.workflow.chatOutput =
    normalized.workflow.chatOutput && typeof normalized.workflow.chatOutput === 'object' && !Array.isArray(normalized.workflow.chatOutput)
      ? { ...normalized.workflow.chatOutput }
      : {};
  normalized.workflow.chatOutput.enabled = normalized.workflow.chatOutput.enabled !== false;
  normalized.workflow.chatOutput.splitDelimiter =
    typeof normalized.workflow.chatOutput.splitDelimiter === 'string' && normalized.workflow.chatOutput.splitDelimiter.trim()
      ? normalized.workflow.chatOutput.splitDelimiter.trim().slice(0, 1)
      : DEFAULT_CONFIG.workflow.chatOutput.splitDelimiter;
  normalized.workflow.chatOutput.typingDelayPerCharMs = Math.max(
    0,
    parseInteger(normalized.workflow.chatOutput.typingDelayPerCharMs, DEFAULT_CONFIG.workflow.chatOutput.typingDelayPerCharMs)
  );
  normalized.workflow.chatOutput.maxTypingDelayMs = Math.max(
    0,
    parseInteger(normalized.workflow.chatOutput.maxTypingDelayMs, DEFAULT_CONFIG.workflow.chatOutput.maxTypingDelayMs)
  );

  normalized.workflowRunLog = normalized.workflowRunLog || {};
  normalized.workflowRunLog.enabled = normalized.workflowRunLog.enabled !== false;
  normalized.workflowRunLog.dataDir = normalized.workflowRunLog.dataDir || DEFAULT_CONFIG.workflowRunLog.dataDir;
  normalized.workflowRunLog.fileName = typeof normalized.workflowRunLog.fileName === 'string' && normalized.workflowRunLog.fileName.trim()
    ? normalized.workflowRunLog.fileName.trim()
    : DEFAULT_CONFIG.workflowRunLog.fileName;
  normalized.workflowRunLog.maxBytes = parseInteger(
    normalized.workflowRunLog.maxBytes,
    DEFAULT_CONFIG.workflowRunLog.maxBytes
  );
  normalized.workflowRunLog.targetBytesAfterCompact = parseInteger(
    normalized.workflowRunLog.targetBytesAfterCompact,
    DEFAULT_CONFIG.workflowRunLog.targetBytesAfterCompact
  );
  normalized.workflowRunLog.compactCheckInterval = parseInteger(
    normalized.workflowRunLog.compactCheckInterval,
    DEFAULT_CONFIG.workflowRunLog.compactCheckInterval
  );
  normalized.workflowRunLog.persist = normalized.workflowRunLog.persist !== false;

  normalized.openclaw = normalized.openclaw || {};
  const hasAgentLabel = typeof normalized.openclaw.agentLabel === 'string' && normalized.openclaw.agentLabel.trim();
  const hasSubagentLabel = typeof normalized.openclaw.subagentLabel === 'string' && normalized.openclaw.subagentLabel.trim();
  const currentAgentLabel = hasAgentLabel ? normalized.openclaw.agentLabel.trim() : '';
  const currentSubagentLabel = hasSubagentLabel ? normalized.openclaw.subagentLabel.trim() : '';
  const openclawAgentLabel = (hasSubagentLabel && (!hasAgentLabel || currentAgentLabel === DEFAULT_CONFIG.openclaw.agentLabel))
    ? currentSubagentLabel
    : (hasAgentLabel ? currentAgentLabel : DEFAULT_CONFIG.openclaw.agentLabel);
  normalized.openclaw.agentLabel = openclawAgentLabel;
  // Keep legacy field for backward compatibility.
  normalized.openclaw.subagentLabel = openclawAgentLabel;
  normalized.openclaw.timeout = parseInteger(normalized.openclaw.timeout, DEFAULT_CONFIG.openclaw.timeout);
  normalized.openclaw.local = normalized.openclaw.local !== false;
  normalized.openclaw.stateless = normalized.openclaw.stateless !== false;
  normalized.openclaw.useNativeSessionContext = normalized.openclaw.useNativeSessionContext === true;
  normalized.openclaw.thinking =
    typeof normalized.openclaw.thinking === 'string' ? normalized.openclaw.thinking.trim().toLowerCase() : '';
  normalized.openclaw.isolatedStatePerRequest = normalized.openclaw.isolatedStatePerRequest === true;
  normalized.openclaw.cleanupStateDirAfterRequest = normalized.openclaw.cleanupStateDirAfterRequest !== false;
  normalized.openclaw.stateDirBase =
    typeof normalized.openclaw.stateDirBase === 'string' && normalized.openclaw.stateDirBase.trim()
      ? normalized.openclaw.stateDirBase.trim()
      : DEFAULT_CONFIG.openclaw.stateDirBase;
  normalized.openclaw.configPath =
    typeof normalized.openclaw.configPath === 'string' ? normalized.openclaw.configPath.trim() : '';

  normalized.providers = normalized.providers && typeof normalized.providers === 'object'
    ? { ...normalized.providers }
    : { ...DEFAULT_CONFIG.providers };
  if (typeof normalized.providers.default === 'string') {
    normalized.providers.default = normalized.providers.default.trim().toLowerCase() || DEFAULT_CONFIG.providers.default;
  } else {
    normalized.providers.default = DEFAULT_CONFIG.providers.default;
  }
  normalized.providers.named = normalized.providers.named && typeof normalized.providers.named === 'object' && !Array.isArray(normalized.providers.named)
    ? Object.fromEntries(
        Object.entries(normalized.providers.named)
          .map(([name, entry]) => {
            const normalizedName = String(name || '').trim().toLowerCase();
            if (!normalizedName || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
              return null;
            }

            return [normalizedName, {
              ...entry,
              type: typeof entry.type === 'string' && entry.type.trim()
                ? entry.type.trim().toLowerCase()
                : 'openai-compatible',
              baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '',
              apiKey: typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '',
              model: typeof entry.model === 'string' ? entry.model.trim() : '',
              endpointPath: typeof entry.endpointPath === 'string' ? entry.endpointPath.trim() : '',
              timeout: parseInteger(entry.timeout, DEFAULT_CONFIG.openclaw.timeout),
              maxTokens: parseInteger(entry.maxTokens, 0),
              enabled: entry.enabled !== false,
              extraBody: entry.extraBody && typeof entry.extraBody === 'object' && !Array.isArray(entry.extraBody)
                ? { ...entry.extraBody }
                : {},
              headers: entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
                ? Object.fromEntries(
                    Object.entries(entry.headers)
                      .map(([key, value]) => [String(key || '').trim(), String(value ?? '').trim()])
                      .filter(([key, value]) => key && value)
                  )
                : {}
            }];
          })
          .filter(Boolean)
      )
    : {};

  normalized.music = normalized.music || {};
  normalized.music.playUrlProviders = Array.isArray(normalized.music.playUrlProviders)
    ? normalized.music.playUrlProviders.map(item => String(item || '').trim()).filter(Boolean)
    : [...DEFAULT_CONFIG.music.playUrlProviders];
  if (normalized.music.playUrlProviders.length === 0) {
    normalized.music.playUrlProviders = [...DEFAULT_CONFIG.music.playUrlProviders];
  }
  normalized.music.providers = normalized.music.providers || {};
  normalized.music.providers.customTemplate = normalized.music.providers.customTemplate || {};
  normalized.music.providers.customTemplate.enabled = normalized.music.providers.customTemplate.enabled === true;
  normalized.music.providers.customTemplate.urlTemplate =
    typeof normalized.music.providers.customTemplate.urlTemplate === 'string'
      ? normalized.music.providers.customTemplate.urlTemplate.trim()
      : DEFAULT_CONFIG.music.providers.customTemplate.urlTemplate;
  normalized.music.providers.iarcDirect = normalized.music.providers.iarcDirect || {};
  normalized.music.providers.iarcDirect.enabled = normalized.music.providers.iarcDirect.enabled !== false;
  normalized.music.providers.iarcDirect.urlTemplate =
    typeof normalized.music.providers.iarcDirect.urlTemplate === 'string' &&
    normalized.music.providers.iarcDirect.urlTemplate.trim()
      ? normalized.music.providers.iarcDirect.urlTemplate.trim()
      : DEFAULT_CONFIG.music.providers.iarcDirect.urlTemplate;
  normalized.music.providers.metingRedirect = normalized.music.providers.metingRedirect || {};
  normalized.music.providers.metingRedirect.enabled = normalized.music.providers.metingRedirect.enabled !== false;
  normalized.music.providers.metingRedirect.endpointTemplate =
    typeof normalized.music.providers.metingRedirect.endpointTemplate === 'string' &&
    normalized.music.providers.metingRedirect.endpointTemplate.trim()
      ? normalized.music.providers.metingRedirect.endpointTemplate.trim()
      : DEFAULT_CONFIG.music.providers.metingRedirect.endpointTemplate;
  normalized.music.providers.neteaseOuter = normalized.music.providers.neteaseOuter || {};
  normalized.music.providers.neteaseOuter.enabled = normalized.music.providers.neteaseOuter.enabled !== false;
  normalized.music.providers.neteaseOuter.urlTemplate =
    typeof normalized.music.providers.neteaseOuter.urlTemplate === 'string' &&
    normalized.music.providers.neteaseOuter.urlTemplate.trim()
      ? normalized.music.providers.neteaseOuter.urlTemplate.trim()
      : DEFAULT_CONFIG.music.providers.neteaseOuter.urlTemplate;

  normalized.messageMemory = normalized.messageMemory || {};
  normalized.messageMemory.enabled = normalized.messageMemory.enabled !== false;
  normalized.messageMemory.dataDir = normalized.messageMemory.dataDir || DEFAULT_CONFIG.messageMemory.dataDir;
  normalized.messageMemory.maxEventsPerChannel = parseInteger(
    normalized.messageMemory.maxEventsPerChannel,
    DEFAULT_CONFIG.messageMemory.maxEventsPerChannel
  );
  normalized.messageMemory.recentMessageCount = parseInteger(
    normalized.messageMemory.recentMessageCount,
    DEFAULT_CONFIG.messageMemory.recentMessageCount
  );
  normalized.messageMemory.maxAnchorRounds = parseInteger(
    normalized.messageMemory.maxAnchorRounds,
    DEFAULT_CONFIG.messageMemory.maxAnchorRounds
  );
  normalized.messageMemory.compactCheckInterval = parseInteger(
    normalized.messageMemory.compactCheckInterval,
    DEFAULT_CONFIG.messageMemory.compactCheckInterval
  );
  normalized.messageMemory.compactOnStartup = normalized.messageMemory.compactOnStartup !== false;
  normalized.messageMemory.maxMessageChars = parseInteger(
    normalized.messageMemory.maxMessageChars,
    DEFAULT_CONFIG.messageMemory.maxMessageChars
  );
  normalized.messageMemory.persist = normalized.messageMemory.persist !== false;

  normalized.meme = normalized.meme || {};
  normalized.meme.enabled = normalized.meme.enabled !== false;
  normalized.meme.requestEmotionTag = normalized.meme.requestEmotionTag !== false;

  const probability = Number(normalized.meme.triggerProbability);
  if (!Number.isFinite(probability)) {
    normalized.meme.triggerProbability = DEFAULT_CONFIG.meme.triggerProbability;
  } else {
    normalized.meme.triggerProbability = Math.min(1, Math.max(0, probability));
  }

  if (Array.isArray(normalized.remotePlugins)) {
    normalized.remotePlugins = { entries: [...normalized.remotePlugins] };
  }
  normalized.remotePlugins = normalized.remotePlugins || {};
  if (!Array.isArray(normalized.remotePlugins.entries)) {
    normalized.remotePlugins.entries = [];
  }
  normalized.remotePlugins.timeout = parseInteger(
    normalized.remotePlugins.timeout,
    DEFAULT_CONFIG.remotePlugins.timeout
  );
  normalized.remotePlugins.allowHttp = Boolean(normalized.remotePlugins.allowHttp);

  if (!isPlainObject(normalized.pluginConfigs)) {
    normalized.pluginConfigs = {};
  }

  normalized.rateLimit = normalized.rateLimit || {};
  normalized.rateLimit.perMinute = parseInteger(normalized.rateLimit.perMinute, DEFAULT_CONFIG.rateLimit.perMinute);

  normalized.policy = normalized.policy || {};
  normalized.policy.allowHighRiskTools = normalized.policy.allowHighRiskTools === true;
  normalized.policy.allowCrossSessionSend = normalized.policy.allowCrossSessionSend === true;
  normalized.policy.maxMessagesPerWorkflow = Math.max(
    1,
    parseInteger(normalized.policy.maxMessagesPerWorkflow, DEFAULT_CONFIG.policy.maxMessagesPerWorkflow)
  );

  return normalized;
}

function buildFingerprint() {
  const fileStats = Object.values(CONFIG_PATHS).map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return `${filePath}:${stat.mtimeMs}`;
    } catch {
      return `${filePath}:missing`;
    }
  });

  const envSnapshot = ENV_KEYS.map(key => `${key}=${process.env[key] || ''}`).join('|');
  return `${fileStats.join('|')}|${envSnapshot}`;
}

function loadRuntimeConfig(options = {}) {
  const { forceReload = false } = options;
  const fingerprint = buildFingerprint();

  if (!forceReload && cachedConfig && cachedFingerprint === fingerprint) {
    return cachedConfig;
  }

  // 优先级：默认值 < app.json < 环境变量
  let merged = deepMerge({}, DEFAULT_CONFIG);

  const appConfig = readJsonIfExists(CONFIG_PATHS.app);
  if (appConfig) merged = deepMerge(merged, appConfig);

  merged = deepMerge(merged, getEnvOverride());
  merged = normalizeConfig(merged);

  cachedConfig = merged;
  cachedFingerprint = fingerprint;
  return merged;
}

function mergeRuntimeConfig(baseConfig, overrideConfig) {
  return normalizeConfig(deepMerge(baseConfig || {}, overrideConfig || {}));
}

module.exports = {
  DEFAULT_CONFIG,
  CONFIG_PATHS,
  loadRuntimeConfig,
  mergeRuntimeConfig,
  normalizeConfig
};
