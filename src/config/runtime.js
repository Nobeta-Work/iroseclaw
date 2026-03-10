/**
 * Runtime config loader
 * 统一配置入口，兼容新旧配置文件并支持环境变量覆盖
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');

const CONFIG_PATHS = {
  example: path.join(CONFIG_DIR, 'app.example.json'),
  legacy: path.join(CONFIG_DIR, 'bot.json'),
  local: path.join(CONFIG_DIR, 'app.local.json')
};

const ENV_KEYS = [
  'IROSE_BOT_UID',
  'IROSE_BOT_NAME',
  'IROSE_BOT_PLATFORM',
  'IROSE_ROOM_ID',
  'IROSE_ADMINS',
  'IROSE_OPENCLAW_SUBAGENT',
  'IROSE_OPENCLAW_TIMEOUT',
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
      allowedActions: ['chat', 'help', 'music', 'admin', 'system', 'config'],
      blockedActions: []
    }
  },
  openclaw: {
    subagentLabel: 'iirose',
    timeout: 30000
  },
  fallbackResponses: [
    '抱歉，我暂时无法处理这个请求。',
    '出了点问题，请稍后再试。',
    '我现在有点忙，晚点再聊吧。',
    '这个功能暂时不可用。'
  ],
  rateLimit: {
    perMinute: 60
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

  if (env.IROSE_OPENCLAW_SUBAGENT || env.IROSE_OPENCLAW_TIMEOUT) {
    override.openclaw = {};
    if (env.IROSE_OPENCLAW_SUBAGENT) {
      override.openclaw.subagentLabel = env.IROSE_OPENCLAW_SUBAGENT;
    }
    if (env.IROSE_OPENCLAW_TIMEOUT) {
      override.openclaw.timeout = parseInteger(env.IROSE_OPENCLAW_TIMEOUT, DEFAULT_CONFIG.openclaw.timeout);
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

  normalized.openclaw = normalized.openclaw || {};
  normalized.openclaw.timeout = parseInteger(normalized.openclaw.timeout, DEFAULT_CONFIG.openclaw.timeout);

  normalized.rateLimit = normalized.rateLimit || {};
  normalized.rateLimit.perMinute = parseInteger(normalized.rateLimit.perMinute, DEFAULT_CONFIG.rateLimit.perMinute);

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

  // 优先级：默认值 < app.example.json < bot.json(兼容) < app.local.json < 环境变量
  let merged = deepMerge({}, DEFAULT_CONFIG);

  const exampleConfig = readJsonIfExists(CONFIG_PATHS.example);
  if (exampleConfig) merged = deepMerge(merged, exampleConfig);

  const legacyConfig = readJsonIfExists(CONFIG_PATHS.legacy);
  if (legacyConfig) merged = deepMerge(merged, legacyConfig);

  const localConfig = readJsonIfExists(CONFIG_PATHS.local);
  if (localConfig) merged = deepMerge(merged, localConfig);

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
