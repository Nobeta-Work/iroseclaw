/**
 * Admin follow room plugin
 * 监听管理员切房事件，并在启用时让 bot 跟随切换房间。
 */

const fs = require('fs');
const path = require('path');
const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');
const { callInternal } = require('../../../services/iirose/internal');
const { isSameUid } = require('../../../utils/uid');

const DEFAULT_SETTINGS = {
  enabled: false,
  updatedAt: 0
};

const DEFAULT_CONFIG = {
  dataDir: path.join(process.cwd(), 'data', 'iirose-admin-follow-room'),
  settingsFile: 'settings.json',
  defaultEnabled: false,
  leaderUid: '',
  followAdmins: [],
  debounceMs: 1500,
  onlyWhenLeavingCurrentRoom: true
};

function normalizeText(value, maxChars = 160) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxChars);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(item => normalizeText(item, 80))
      .filter(Boolean)
  )];
}

function normalizeRoomId(value) {
  return normalizeText(value, 80);
}

function normalizeRoomKey(value) {
  return normalizeRoomId(value).toLowerCase();
}

function sameRoom(a, b) {
  const left = normalizeRoomKey(a);
  const right = normalizeRoomKey(b);
  return Boolean(left) && Boolean(right) && left === right;
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
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

function mergeSettings(defaults, persisted, overrides = {}) {
  return {
    enabled: overrides.enabled !== undefined
      ? overrides.enabled === true
      : (persisted?.enabled === true || persisted?.enabled === false
        ? persisted.enabled
        : defaults.enabled === true),
    updatedAt: overrides.updatedAt !== undefined
      ? Number(overrides.updatedAt) || 0
      : (Number(persisted?.updatedAt) || defaults.updatedAt || 0)
  };
}

function createSettingsStore(pluginConfig = {}) {
  const defaults = {
    enabled: pluginConfig.defaultEnabled === true,
    updatedAt: 0
  };
  const dataDir = normalizeText(pluginConfig.dataDir, 240) || DEFAULT_CONFIG.dataDir;
  const settingsFile = normalizeText(pluginConfig.settingsFile, 120) || DEFAULT_CONFIG.settingsFile;
  const settingsPath = path.join(dataDir, settingsFile);
  const persisted = readJsonFile(settingsPath, null);
  let settings = mergeSettings(defaults, persisted);

  return {
    get() {
      return { ...settings };
    },
    setEnabled(enabled) {
      settings = mergeSettings(defaults, settings, {
        enabled: enabled === true,
        updatedAt: Date.now()
      });
      writeJsonFile(settingsPath, settings);
      return this.get();
    }
  };
}

function resolveEventUserId(session, data = {}) {
  return normalizeText(
    data.uid
    || data.userId
    || session?.user?.id
    || session?.userId,
    80
  );
}

function resolveOriginRoom(session, data = {}) {
  return normalizeRoomId(
    data.room
    || data.fromRoom
    || session?.channelId
    || session?.guildId
    || ''
  );
}

function resolveTargetRoom(session, data = {}) {
  return normalizeRoomId(
    data.targetRoom
    || data.toRoom
    || data.target?.roomId
    || ''
  );
}

async function resolveCurrentRoom(session, fallback = '') {
  try {
    const liveRoomId = await callInternal(session, 'getRoomId');
    const roomId = normalizeRoomId(liveRoomId);
    if (roomId) {
      return roomId;
    }
  } catch {
    // fallback below
  }

  return normalizeRoomId(fallback);
}

function logInfo(logger, tag, message) {
  if (typeof logger?.INFO === 'function') {
    logger.INFO(tag, message);
    return;
  }
  logger?.info?.(`[${tag}] ${message}`);
}

function logWarn(logger, tag, message) {
  if (typeof logger?.WARN === 'function') {
    logger.WARN(tag, message);
    return;
  }
  logger?.warn?.(`[${tag}] ${message}`);
}

function logDebug(logger, tag, message) {
  if (typeof logger?.DEBUG === 'function') {
    logger.DEBUG(tag, message);
    return;
  }
  logger?.debug?.(`[${tag}] ${message}`);
}

function formatTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '暂无';
  return new Date(num).toLocaleString('zh-CN', { hour12: false });
}

function resolveTrackedAdmins(config = {}, pluginConfig = {}) {
  const leaderUid = normalizeText(pluginConfig.leaderUid, 80);
  if (leaderUid) {
    return [leaderUid];
  }

  const followAdmins = normalizeStringArray(pluginConfig.followAdmins);
  if (followAdmins.length > 0) {
    return followAdmins;
  }

  return normalizeStringArray(config.admins);
}

function createAdminTool(options = {}) {
  const {
    name,
    description,
    aliases = [],
    directAliases = [],
    config,
    service,
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
          context,
          service
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

function createAdminFollowRoomService(options = {}) {
  const config = options.config || {};
  const pluginConfig = {
    ...DEFAULT_CONFIG,
    ...(options.pluginConfig || {})
  };
  const settingsStore = createSettingsStore(pluginConfig);
  const state = {
    inFlight: false,
    lastFollowAt: 0,
    lastAdminUid: '',
    lastOriginRoom: '',
    lastTargetRoom: ''
  };

  function isTrackedAdmin(userId = '') {
    if (!isAdminUser(config, userId)) {
      return false;
    }

    const leaderUid = normalizeText(pluginConfig.leaderUid, 80);
    if (leaderUid) {
      return isSameUid(leaderUid, userId);
    }

    const followAdmins = normalizeStringArray(pluginConfig.followAdmins);
    if (followAdmins.length === 0) {
      return true;
    }

    return followAdmins.some(item => isSameUid(item, userId));
  }

  function getStatus() {
    const settings = settingsStore.get();
    return {
      enabled: settings.enabled === true,
      updatedAt: Number(settings.updatedAt) || 0,
      leaderUid: normalizeText(pluginConfig.leaderUid, 80),
      trackedAdmins: resolveTrackedAdmins(config, pluginConfig),
      debounceMs: toPositiveInt(pluginConfig.debounceMs, DEFAULT_CONFIG.debounceMs),
      onlyWhenLeavingCurrentRoom: pluginConfig.onlyWhenLeavingCurrentRoom !== false,
      lastFollowAt: state.lastFollowAt,
      lastAdminUid: state.lastAdminUid,
      lastOriginRoom: state.lastOriginRoom,
      lastTargetRoom: state.lastTargetRoom,
      inFlight: state.inFlight
    };
  }

  function createStatusText() {
    const status = getStatus();
    const trackedText = status.leaderUid
      ? `指定管理员 ${status.leaderUid}`
      : (status.trackedAdmins.length > 0 ? status.trackedAdmins.join('、') : '未配置管理员');
    const lastFollowText = status.lastFollowAt > 0
      ? `${status.lastAdminUid || '未知管理员'}: ${status.lastOriginRoom || '?'} -> ${status.lastTargetRoom || '?'} @ ${formatTimestamp(status.lastFollowAt)}`
      : '暂无';

    return [
      '管理员跟随切房状态',
      `状态: ${status.enabled ? '已开启' : '已关闭'}`,
      `跟随对象: ${trackedText}`,
      `策略: ${status.onlyWhenLeavingCurrentRoom ? '仅当管理员从 bot 当前房间离开时跟随' : '检测到管理员切房就直接跟随'}`,
      `防抖: ${status.debounceMs}ms`,
      `最近一次跟随: ${lastFollowText}`
    ].join('\n');
  }

  async function enable() {
    const next = settingsStore.setEnabled(true);
    return {
      ...next,
      text: `已开启管理员跟随切房。\n${createStatusText()}`
    };
  }

  async function disable() {
    const next = settingsStore.setEnabled(false);
    return {
      ...next,
      text: `已关闭管理员跟随切房。\n${createStatusText()}`
    };
  }

  async function handleSwitchRoom(session, data = {}) {
    const adminUid = resolveEventUserId(session, data);
    const originRoom = resolveOriginRoom(session, data);
    const targetRoom = resolveTargetRoom(session, data);
    const baseResult = {
      ok: false,
      reason: '',
      adminUid,
      originRoom,
      targetRoom,
      currentRoom: ''
    };
    const settings = settingsStore.get();
    if (settings.enabled !== true) {
      return {
        ...baseResult,
        reason: 'disabled'
      };
    }

    if (!adminUid) {
      return {
        ...baseResult,
        reason: 'missing-admin'
      };
    }

    if (isSameUid(config.bot?.uid || '', adminUid)) {
      return {
        ...baseResult,
        reason: 'bot-self'
      };
    }

    if (!isTrackedAdmin(adminUid)) {
      return {
        ...baseResult,
        reason: 'admin-not-tracked'
      };
    }

    if (!targetRoom || targetRoom.startsWith('private:')) {
      return {
        ...baseResult,
        reason: 'missing-target-room'
      };
    }

    if (originRoom && sameRoom(originRoom, targetRoom)) {
      return {
        ...baseResult,
        reason: 'same-room-switch'
      };
    }

    const currentRoom = await resolveCurrentRoom(
      session,
      originRoom || session?.channelId || config.roomId || ''
    );
    baseResult.currentRoom = currentRoom;

    if (currentRoom && sameRoom(currentRoom, targetRoom)) {
      return {
        ...baseResult,
        reason: 'already-in-target-room'
      };
    }

    if (pluginConfig.onlyWhenLeavingCurrentRoom !== false) {
      if (!originRoom || !currentRoom) {
        return {
          ...baseResult,
          reason: 'cannot-verify-origin-room'
        };
      }
      if (!sameRoom(currentRoom, originRoom)) {
        return {
          ...baseResult,
          reason: 'admin-left-other-room'
        };
      }
    }

    const now = Date.now();
    const debounceMs = toPositiveInt(pluginConfig.debounceMs, DEFAULT_CONFIG.debounceMs);
    const sameAdminAndTarget = isSameUid(state.lastAdminUid, adminUid) && sameRoom(state.lastTargetRoom, targetRoom);

    if (state.inFlight && sameAdminAndTarget) {
      return {
        ...baseResult,
        reason: 'follow-in-flight'
      };
    }

    if (debounceMs > 0 && sameAdminAndTarget && now - state.lastFollowAt < debounceMs) {
      return {
        ...baseResult,
        reason: 'debounced'
      };
    }

    state.inFlight = true;
    try {
      await callInternal(session, 'moveRoom', { roomId: targetRoom });
      state.lastFollowAt = Date.now();
      state.lastAdminUid = adminUid;
      state.lastOriginRoom = originRoom || currentRoom;
      state.lastTargetRoom = targetRoom;
      return {
        ...baseResult,
        ok: true,
        moved: true,
        adminUid,
        originRoom: state.lastOriginRoom,
        targetRoom,
        currentRoom
      };
    } finally {
      state.inFlight = false;
    }
  }

  return {
    getStatus,
    createStatusText,
    enable,
    disable,
    handleSwitchRoom
  };
}

module.exports = {
  name: 'iirose-admin-follow-room',
  createAdminFollowRoomService,
  apply(host, context) {
    const scopedConfig = context.getPluginConfig({});
    const service = createAdminFollowRoomService({
      config: context.config,
      pluginConfig: scopedConfig,
      logger: context.logger || host.logger || console
    });

    host.registerService('iirose.admin-follow-room', service);

    const cleanup = context.ctx?.on?.('iirose/guild-member-switchRoom', async (session, data) => {
      try {
        logInfo(
          context.logger || host.logger || console,
          'FOLLOW_ROOM',
          `received switchRoom event uid=${resolveEventUserId(session, data) || '?'} room=${resolveOriginRoom(session, data) || '?'} target=${resolveTargetRoom(session, data) || '?'}`
        );
        const result = await service.handleSwitchRoom(session, data);
        if (result.ok) {
          logInfo(
            context.logger || host.logger || console,
            'FOLLOW_ROOM',
            `followed admin ${result.adminUid} from ${result.originRoom || '?'} to ${result.targetRoom} (current=${result.currentRoom || '?'})`
          );
        } else {
          logInfo(
            context.logger || host.logger || console,
            'FOLLOW_ROOM',
            `skip switchRoom reason=${result.reason || 'unknown'} uid=${result.adminUid || '?'} room=${result.originRoom || '?'} target=${result.targetRoom || '?'} current=${result.currentRoom || '?'}`
          );
        }
      } catch (error) {
        logWarn(
          context.logger || host.logger || console,
          'FOLLOW_ROOM',
          `failed to follow admin room switch: ${error.message}`
        );
      }
    });
    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    const selfMoveCleanup = context.ctx?.on?.('iirose/selfMove', async (session, data) => {
      const selfMoveId = normalizeText(data?.id, 80);
      const currentRoom = await resolveCurrentRoom(session, session?.channelId || context.config?.roomId || '');
      logDebug(
        context.logger || host.logger || console,
        'FOLLOW_ROOM',
        `received selfMove event id=${selfMoveId || '?'} current=${currentRoom || '?'}`
      );
    });
    if (typeof selfMoveCleanup === 'function') {
      context.registerCleanup(selfMoveCleanup);
    }

    context.registerToolPackage({
      name: 'iirose-admin-follow-room-package',
      version: '0.1.0',
      tools: [
        createAdminTool({
          name: 'iirose.room.follow.enable',
          description: '开启管理员切房时 bot 自动跟随。',
          aliases: ['开启跟随切房', '开启跟随模式', '开启跟房', '打开跟房'],
          directAliases: ['开启跟随切房', '开启跟随模式', '开启跟房', '打开跟房'],
          config: context.config,
          service,
          handler: async ({ service: svc }) => {
            const result = await svc.enable();
            return result.text;
          }
        }),
        createAdminTool({
          name: 'iirose.room.follow.disable',
          description: '关闭管理员切房时 bot 自动跟随。',
          aliases: ['关闭跟随切房', '关闭跟随模式', '关闭跟房', '停止跟房'],
          directAliases: ['关闭跟随切房', '关闭跟随模式', '关闭跟房', '停止跟房'],
          config: context.config,
          service,
          handler: async ({ service: svc }) => {
            const result = await svc.disable();
            return result.text;
          }
        }),
        createAdminTool({
          name: 'iirose.room.follow.status',
          description: '查看管理员跟随切房状态。',
          aliases: ['跟随切房状态', '跟随模式状态', '跟房状态', '查看跟随切房状态'],
          directAliases: ['跟随切房状态', '跟随模式状态', '跟房状态', '查看跟随切房状态'],
          config: context.config,
          service,
          handler: async ({ service: svc }) => svc.createStatusText()
        })
      ],
      triggerTemplates: [
        {
          kind: 'message.mentioned',
          template: {
            toolNames: [
              'iirose.room.follow.enable',
              'iirose.room.follow.disable',
              'iirose.room.follow.status'
            ],
            instruction: '管理员提到“开启跟随切房”“关闭跟随切房”“跟随切房状态”等命令时，优先调用对应的 iirose.room.follow.* 工具，不要当作普通聊天。'
          }
        },
        {
          kind: 'message.private',
          template: {
            toolNames: [
              'iirose.room.follow.enable',
              'iirose.room.follow.disable',
              'iirose.room.follow.status'
            ],
            instruction: '管理员私聊时，可直接开启、关闭或查看“管理员切房自动跟随”状态。'
          }
        }
      ],
      metadata: {
        pluginName: 'iirose-admin-follow-room',
        adminOnly: true,
        description: '管理员切房跟随插件'
      }
    });

    logInfo(context.logger || host.logger || console, 'FOLLOW_ROOM', 'Admin follow room plugin loaded');
  }
};
