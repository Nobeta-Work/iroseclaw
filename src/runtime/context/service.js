/**
 * Context Service
 * 封装消息上下文存储与构建，避免入口层直接操作存储细节
 */

const path = require('path');
const { MessageMemoryStore } = require('../../plugins/message-memory');

const GLOBAL_SHARED_CHANNEL_ID = 'global-shared';

function normalizeText(value, max = 160) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeSourceScope(value, channelId = '') {
  const text = normalizeText(value, 32).toLowerCase();
  if (text === 'public' || text === 'private') {
    return text;
  }
  if (String(channelId || '').startsWith('private:')) {
    return 'private';
  }
  return 'public';
}

function resolveGlobalDataDir(config = {}) {
  const explicit = normalizeText(config.globalSharedDataDir || config.globalDataDir || '', 260);
  if (explicit) {
    return explicit;
  }

  const defaultDataDir = path.join(process.cwd(), 'data', 'message-memory');
  const dataDir = normalizeText(config.dataDir || defaultDataDir, 260);

  const trimmed = dataDir.replace(/[\\/]+$/, '');
  return `${trimmed}-global`;
}

class ContextService {
  constructor(config = {}) {
    this.config = { ...config };
    this.store = new MessageMemoryStore(config);
    const globalDataDir = resolveGlobalDataDir(config);
    this.globalSharedStore = globalDataDir
      ? new MessageMemoryStore({
          ...config,
          dataDir: globalDataDir
        })
      : null;
  }

  addUserMessage(input = {}) {
    return this.store.addUserMessage(input);
  }

  addBotMessage(input = {}) {
    const localMessage = this.store.addBotMessage(input);
    const globalMessage = this._addGlobalSharedBotMessage(input);
    if (localMessage && globalMessage && typeof localMessage === 'object') {
      localMessage.globalSharedEventId = globalMessage.id;
    }
    return localMessage;
  }

  buildContext(input = {}) {
    const localContext = this.store.buildContext(input);
    const globalContext = this._buildGlobalSharedContext(input);

    return {
      ...localContext,
      globalSharedRecentMessages: Array.isArray(globalContext.recentMessages)
        ? globalContext.recentMessages
        : [],
      globalSharedHistorySummary: Array.isArray(globalContext.historySummary)
        ? globalContext.historySummary
        : [],
      globalSharedAnchorCount: Number.isFinite(Number(globalContext.anchorCount))
        ? Number(globalContext.anchorCount)
        : 0
    };
  }

  captureIncomingMessage(trigger = {}) {
    const localMessage = this.addUserMessage({
      channelId: trigger.channelId,
      messageId: trigger.messageId,
      userId: trigger.userId,
      username: trigger.username,
      content: trigger.cleanedContent,
      rawContent: trigger.rawContent,
      isMentionBot: trigger.isMentioned,
      sourceScope: normalizeSourceScope(trigger.sourceScope || (trigger.isPrivateSession === true ? 'private' : 'public'), trigger.channelId),
      sourceChannelId: normalizeText(trigger.sourceChannelId || trigger.channelId || '', 160) || normalizeText(trigger.channelId || '', 160),
      sourceTriggerKind: normalizeText(trigger.kind || trigger.sourceTriggerKind || '', 80),
      timestamp: trigger.timestamp
    });

    const globalMessage = this._shouldRecordGlobalSharedIncoming(trigger)
      ? this._addGlobalSharedUserMessage({
          channelId: trigger.channelId,
          messageId: trigger.messageId,
          userId: trigger.userId,
          username: trigger.username,
          content: trigger.cleanedContent,
          rawContent: trigger.rawContent,
          isMentionBot: trigger.isMentioned,
          sourceScope: normalizeSourceScope(trigger.sourceScope || (trigger.isPrivateSession === true ? 'private' : 'public'), trigger.channelId),
          sourceChannelId: normalizeText(trigger.sourceChannelId || trigger.channelId || '', 160) || normalizeText(trigger.channelId || '', 160),
          sourceTriggerKind: normalizeText(trigger.kind || trigger.sourceTriggerKind || '', 80),
          timestamp: trigger.timestamp
        })
      : null;

    if (localMessage && globalMessage && typeof localMessage === 'object') {
      localMessage.globalSharedEventId = globalMessage.id;
    }

    return localMessage;
  }

  buildConversationContextFromTrigger(trigger = {}, currentEventId = null) {
    return this.buildContext({
      channelId: trigger.channelId,
      currentEventId,
      currentGlobalEventId: trigger.globalSharedEventId || trigger.currentGlobalEventId || null,
      userId: trigger.userId,
      username: trigger.username,
      currentContent: trigger.cleanedContent,
      currentRawContent: trigger.rawContent,
      sourceScope: trigger.sourceScope,
      sourceChannelId: trigger.sourceChannelId,
      sourceTriggerKind: trigger.kind,
      timestamp: trigger.timestamp
    });
  }

  getMessagesInWindow(channelId, fromTs, toTs, options = {}) {
    return this.store.getMessagesInWindow({
      channelId,
      fromTs,
      toTs,
      roles: options.roles
    });
  }

  getGlobalSharedMessagesInWindow(fromTs, toTs, options = {}) {
    if (!this.globalSharedStore) {
      return [];
    }

    return this.globalSharedStore.getMessagesInWindow({
      channelId: GLOBAL_SHARED_CHANNEL_ID,
      fromTs,
      toTs,
      roles: options.roles
    });
  }

  _buildGlobalSharedContext(input = {}) {
    if (!this.globalSharedStore) {
      return {
        recentMessages: [],
        historySummary: [],
        anchorCount: 0
      };
    }

    const globalContext = this.globalSharedStore.buildContext({
      channelId: GLOBAL_SHARED_CHANNEL_ID,
      currentEventId: input.currentGlobalEventId || null,
      userId: input.userId,
      username: input.username,
      currentContent: input.currentContent,
      currentRawContent: input.currentRawContent,
      sourceScope: input.sourceScope,
      sourceChannelId: input.sourceChannelId,
      sourceTriggerKind: input.sourceTriggerKind,
      timestamp: input.timestamp
    });

    return {
      recentMessages: Array.isArray(globalContext.recentMessages) ? globalContext.recentMessages : [],
      historySummary: Array.isArray(globalContext.historySummary) ? globalContext.historySummary : [],
      anchorCount: Number.isFinite(Number(globalContext.anchorCount)) ? Number(globalContext.anchorCount) : 0
    };
  }

  _addGlobalSharedUserMessage(input = {}) {
    if (!this.globalSharedStore) {
      return null;
    }

    const sourceChannelId = normalizeText(input.sourceChannelId || input.channelId || '', 160) || normalizeText(input.channelId || '', 160);
    if (!sourceChannelId) {
      return null;
    }

    return this.globalSharedStore.addUserMessage({
      ...input,
      channelId: GLOBAL_SHARED_CHANNEL_ID,
      sourceScope: normalizeSourceScope(input.sourceScope, sourceChannelId),
      sourceChannelId,
      sourceTriggerKind: normalizeText(input.sourceTriggerKind || input.triggerKind || '', 80)
    });
  }

  _addGlobalSharedBotMessage(input = {}) {
    if (!this.globalSharedStore) {
      return null;
    }

    const sourceChannelId = normalizeText(input.sourceChannelId || input.channelId || '', 160) || normalizeText(input.channelId || '', 160);
    if (!sourceChannelId) {
      return null;
    }

    return this.globalSharedStore.addBotMessage({
      ...input,
      channelId: GLOBAL_SHARED_CHANNEL_ID,
      sourceScope: normalizeSourceScope(input.sourceScope, sourceChannelId),
      sourceChannelId,
      sourceTriggerKind: normalizeText(input.sourceTriggerKind || input.triggerKind || '', 80)
    });
  }

  _shouldRecordGlobalSharedIncoming(trigger = {}) {
    if (trigger.isPrivateSession === true) {
      return true;
    }

    if (trigger.isMentioned === true) {
      return true;
    }

    const kind = normalizeText(trigger.kind || '', 80).toLowerCase();
    return kind === 'message.private';
  }
}

module.exports = {
  ContextService
};
