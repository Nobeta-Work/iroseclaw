const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MessageMemoryStore {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      dataDir: path.resolve(config.dataDir || path.join(process.cwd(), 'data', 'message-memory')),
      maxEventsPerChannel: toPositiveInt(config.maxEventsPerChannel, 400),
      recentMessageCount: toPositiveInt(config.recentMessageCount, 20),
      channelRecentMessageCount: toPositiveInt(config.channelRecentMessageCount, 12),
      anchorLookBehind: toPositiveInt(config.anchorLookBehind, 4),
      anchorLookAhead: toPositiveInt(config.anchorLookAhead, 4),
      detailedAnchorCount: toPositiveInt(config.detailedAnchorCount, 3),
      summaryAnchorCount: toPositiveInt(config.summaryAnchorCount, 4),
      maxAnchorRounds: toPositiveInt(config.maxAnchorRounds, 20),
      maxMessageChars: toPositiveInt(config.maxMessageChars, 180),
      maxSummaryChars: toPositiveInt(config.maxSummaryChars, 220),
      compactCheckInterval: toPositiveInt(config.compactCheckInterval, 50),
      compactOnStartup: config.compactOnStartup !== false,
      persist: config.persist !== false
    };
    this.channels = new Map();
    this.sequence = 0;
    this.appendCounters = new Map();

    if (this.config.enabled && this.config.persist) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }
  }

  addUserMessage(input = {}) {
    return this._appendEvent({
      channelId: resolveStorageKey(input),
      messageId: normalizeText(input.messageId, 80),
      role: 'user',
      userId: normalizeText(input.userId, 80) || 'unknown',
      username: normalizeText(input.username, 80) || '未知用户',
      content: normalizeContent(input.content, this.config.maxMessageChars),
      rawContent: normalizeContent(input.rawContent, this.config.maxMessageChars),
      isMentionBot: Boolean(input.isMentionBot),
      timestamp: normalizeTimestamp(input.timestamp)
    });
  }

  addBotMessage(input = {}) {
    return this._appendEvent({
      channelId: resolveStorageKey(input),
      messageId: normalizeText(input.messageId, 80),
      role: 'assistant',
      userId: normalizeText(input.userId, 80) || 'bot',
      username: normalizeText(input.username, 80) || 'Bot',
      content: normalizeContent(input.content, this.config.maxMessageChars),
      rawContent: normalizeContent(input.rawContent, this.config.maxMessageChars),
      isMentionBot: false,
      timestamp: normalizeTimestamp(input.timestamp)
    });
  }

  buildContext(input = {}) {
    const channelId = resolveStorageKey(input);
    const triggerUserId = normalizeText(input.userId, 80) || 'unknown';
    const triggerUsername = normalizeText(input.username, 80) || '未知用户';
    const state = this._getChannelState(channelId);

    const fallback = {
      triggerUser: {
        id: triggerUserId,
        name: triggerUsername
      },
      currentMessage: {
        userId: triggerUserId,
        username: triggerUsername,
        content: normalizeContent(input.currentContent, this.config.maxMessageChars),
        rawContent: normalizeContent(input.currentRawContent ?? input.currentContent, this.config.maxMessageChars),
        timestamp: normalizeTimestamp(input.timestamp)
      },
      recentMessages: [],
      channelRecentMessages: [],
      historySummary: [],
      anchorCount: 0
    };

    if (!this.config.enabled || !state || state.events.length === 0) {
      return fallback;
    }

    const currentIndex = this._findCurrentIndex(state.events, input.currentEventId);
    const currentEvent = state.events[currentIndex] || null;
    const currentMessage = currentEvent
      ? this._serializeEvent(currentEvent)
      : fallback.currentMessage;

    const channelStart = Math.max(0, currentIndex - this.config.channelRecentMessageCount + 1);
    const channelRecentMessages = state.events
      .slice(channelStart, currentIndex + 1)
      .filter(event => event?.content)
      .map(event => this._serializeEvent(event));

    const anchorIndices = [];
    for (let index = 0; index <= currentIndex; index += 1) {
      const event = state.events[index];
      if (event?.role === 'user' && event.isMentionBot === true) {
        anchorIndices.push(index);
      }
    }

    let recentMessages = [];
    let historySummary = [];

    if (anchorIndices.length > 0) {
      const retainedAnchorIndices = anchorIndices.slice(-this.config.maxAnchorRounds);
      const droppedAnchorCount = Math.max(0, anchorIndices.length - retainedAnchorIndices.length);
      const detailedAnchorIndices = retainedAnchorIndices.slice(-this.config.detailedAnchorCount);
      const summaryAnchorIndices = retainedAnchorIndices
        .slice(0, Math.max(0, retainedAnchorIndices.length - detailedAnchorIndices.length))
        .slice(-this.config.summaryAnchorCount);

      const mergedRanges = mergeRanges(
        detailedAnchorIndices
          .map(anchorIndex => this._buildAnchorRange(state.events, anchorIndices, anchorIndex, currentIndex))
          .filter(Boolean)
      );

      for (const range of mergedRanges) {
        for (let index = range.start; index <= range.end; index += 1) {
          const event = state.events[index];
          if (!event?.content) continue;
          recentMessages.push(this._serializeEvent(event));
        }
      }

      historySummary = summaryAnchorIndices
        .map(anchorIndex => this._summarizeAnchor(state.events, anchorIndices, anchorIndex, currentIndex))
        .filter(Boolean);

      if (droppedAnchorCount > 0) {
        const earliestRetainedAnchor = retainedAnchorIndices[0];
        const summary = this._summarizeDroppedAnchors(state.events, earliestRetainedAnchor, droppedAnchorCount);
        if (summary) {
          historySummary.unshift(summary);
        }
      }
    }

    const linearRecentMessages = state.events
      .slice(Math.max(0, currentIndex - this.config.recentMessageCount + 1), currentIndex + 1)
      .filter(event => event?.content)
      .map(event => this._serializeEvent(event));

    if (recentMessages.length === 0) {
      recentMessages = linearRecentMessages;
    } else if (recentMessages.length < this.config.recentMessageCount) {
      const seenKeys = new Set(
        recentMessages.map(item => buildEventIdentityKey(item))
      );
      const padded = [];
      for (const item of linearRecentMessages) {
        const key = buildEventIdentityKey(item);
        if (seenKeys.has(key)) continue;
        padded.push(item);
      }
      recentMessages = [...padded, ...recentMessages]
        .slice(-this.config.recentMessageCount);
    }

    return {
      triggerUser: {
        id: triggerUserId,
        name: triggerUsername
      },
      currentMessage,
      recentMessages,
      channelRecentMessages,
      historySummary,
      anchorCount: anchorIndices.length,
      anchorCountRetained: Math.min(anchorIndices.length, this.config.maxAnchorRounds)
    };
  }

  getMessagesInWindow(input = {}) {
    const channelId = resolveStorageKey(input);
    const state = this._getChannelState(channelId);
    const fromTs = Number(input.fromTs);
    const toTs = Number(input.toTs);
    const roles = Array.isArray(input.roles)
      ? input.roles.map(item => String(item || '').trim()).filter(Boolean)
      : [];

    if (!this.config.enabled || !state || state.events.length === 0) {
      return [];
    }

    return state.events
      .filter((event) => {
        if (!event || !event.content) return false;
        if (Number.isFinite(fromTs) && event.timestamp < fromTs) return false;
        if (Number.isFinite(toTs) && event.timestamp >= toTs) return false;
        if (roles.length > 0 && !roles.includes(event.role)) return false;
        return true;
      })
      .map(event => this._serializeEvent(event));
  }

  _appendEvent(event) {
    if (!this.config.enabled) return null;
    if (!event.channelId || !event.content) return null;

    const state = this._getChannelState(event.channelId);
    const stored = {
      ...event,
      timestamp: normalizeTimestamp(event.timestamp),
      id: ++this.sequence
    };

    state.events.push(stored);
    if (state.events.length > this.config.maxEventsPerChannel) {
      state.events.splice(0, state.events.length - this.config.maxEventsPerChannel);
    }

    if (this.config.persist) {
      this._appendToFile(stored);
      this._compactFileIfNeeded(stored.channelId, state.events);
    }

    return stored;
  }

  _getChannelState(channelId) {
    if (!this.config.enabled) return null;

    let state = this.channels.get(channelId);
    if (!state) {
      state = {
        events: this.config.persist ? this._loadChannelEvents(channelId) : []
      };
      this.channels.set(channelId, state);
      this.appendCounters.set(channelId, 0);
    }
    return state;
  }

  _loadChannelEvents(channelId) {
    const filePath = this._getChannelFilePath(channelId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const events = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return normalizeStoredEvent(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(-this.config.maxEventsPerChannel);

      if (this.config.compactOnStartup && events.length > 0) {
        this._rewriteChannelFile(channelId, events);
      }

      for (const event of events) {
        const id = Number(event?.id);
        if (Number.isFinite(id) && id > this.sequence) {
          this.sequence = id;
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  _appendToFile(event) {
    const filePath = this._getChannelFilePath(event.channelId);
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  _compactFileIfNeeded(channelId, tailEvents = []) {
    const nextCounter = (this.appendCounters.get(channelId) || 0) + 1;
    this.appendCounters.set(channelId, nextCounter);
    if (nextCounter % this.config.compactCheckInterval !== 0) {
      return;
    }

    const events = Array.isArray(tailEvents) && tailEvents.length > 0
      ? tailEvents.slice(-this.config.maxEventsPerChannel)
      : this._loadChannelEvents(channelId);
    this._rewriteChannelFile(channelId, events);
  }

  _rewriteChannelFile(channelId, events = []) {
    const filePath = this._getChannelFilePath(channelId);
    if (!Array.isArray(events) || events.length === 0) {
      fs.writeFileSync(filePath, '', 'utf8');
      return;
    }

    const tail = events.slice(-this.config.maxEventsPerChannel);
    const lines = tail.map(item => `${JSON.stringify(item)}\n`).join('');
    fs.writeFileSync(filePath, lines, 'utf8');
  }

  _getChannelFilePath(channelId) {
    const hash = crypto.createHash('sha1').update(channelId).digest('hex');
    return path.join(this.config.dataDir, `${hash}.jsonl`);
  }

  _findCurrentIndex(events, currentEventId) {
    if (!currentEventId) {
      return events.length - 1;
    }

    const index = events.findIndex(event => event.id === currentEventId);
    return index >= 0 ? index : events.length - 1;
  }

  _serializeEvent(event) {
    return {
      role: event.role,
      userId: event.userId,
      username: event.username,
      content: event.content,
      rawContent: event.rawContent,
      timestamp: normalizeTimestamp(event.timestamp),
      isMentionBot: event.isMentionBot
    };
  }

  _buildAnchorRange(events, anchorIndices, anchorIndex, currentIndex) {
    const previousAnchor = getPreviousAnchor(anchorIndices, anchorIndex);
    const nextAnchor = getNextAnchor(anchorIndices, anchorIndex);

    let start = Math.max(0, anchorIndex - this.config.anchorLookBehind);
    let end = Math.min(currentIndex, anchorIndex + this.config.anchorLookAhead);

    if (typeof previousAnchor === 'number') {
      start = Math.max(start, previousAnchor + 1);
    }

    if (typeof nextAnchor === 'number') {
      end = Math.min(end, nextAnchor - 1);
    }

    if (anchorIndex === currentIndex) {
      end = currentIndex;
    }

    if (start > end || !events[anchorIndex]) {
      return null;
    }

    return { start, end };
  }

  _summarizeAnchor(events, anchorIndices, anchorIndex, currentIndex) {
    const anchorEvent = events[anchorIndex];
    if (!anchorEvent) return '';

    const nextAnchor = getNextAnchor(anchorIndices, anchorIndex);
    const searchEnd = Math.min(
      currentIndex,
      typeof nextAnchor === 'number' ? nextAnchor - 1 : anchorIndex + this.config.anchorLookAhead + 2
    );

    let botReply = '';
    for (let index = anchorIndex + 1; index <= searchEnd; index += 1) {
      if (events[index]?.role === 'assistant' && events[index]?.content) {
        botReply = events[index].content;
        break;
      }
    }

    const timestampLabel = formatTimestamp(anchorEvent.timestamp);
    const anchorText = truncateText(anchorEvent.content, this.config.maxSummaryChars);
    const replyText = botReply ? truncateText(botReply, this.config.maxSummaryChars) : '未记录到机器人回复';
    return `${timestampLabel} ${anchorEvent.username}(uid=${anchorEvent.userId}) @bot: ${anchorText} | bot: ${replyText}`;
  }

  _summarizeDroppedAnchors(events, earliestRetainedAnchor, droppedAnchorCount) {
    const retainedEvent = events[earliestRetainedAnchor];
    if (!retainedEvent || droppedAnchorCount <= 0) {
      return '';
    }

    const ts = formatTimestamp(retainedEvent.timestamp);
    return `更早共 ${droppedAnchorCount} 轮 @bot 记忆已压缩（保留从 ${ts} 起的最近 ${this.config.maxAnchorRounds} 轮）。`;
  }
}

function normalizeStoredEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }

  return {
    ...event,
    timestamp: normalizeTimestamp(event.timestamp)
  };
}

function buildEventIdentityKey(event = {}) {
  return [
    normalizeText(event.userId, 80),
    normalizeText(event.username, 80),
    normalizeText(event.content, 180),
    normalizeText(event.rawContent, 180),
    String(normalizeTimestamp(event.timestamp))
  ].join('|');
}

function resolveStorageKey(input = {}) {
  const channelId = normalizeText(input.channelId, 160);
  if (channelId) return channelId;

  const userId = normalizeText(input.userId, 80);
  if (userId) return `user:${userId}`;

  const messageId = normalizeText(input.messageId, 80);
  if (messageId) return `message:${messageId}`;

  return 'global';
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function normalizeText(value, maxChars = 120) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxChars);
}

function normalizeContent(value, maxChars) {
  const text = normalizeText(value, Math.max(maxChars * 2, maxChars));
  if (!text) return '';
  return truncateText(text.replace(/\s+/g, ' '), maxChars);
}

function normalizeTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return Date.now();
  }

  const normalized = Math.floor(num);
  // IIROSE message events may surface Unix seconds while runtime windows use ms.
  // Only coerce realistic epoch-second values to avoid mutating synthetic small test timestamps.
  if (normalized >= 1e9 && normalized < 1e12) {
    return normalized * 1000;
  }

  return normalized;
}

function truncateText(value, maxChars) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function mergeRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function getPreviousAnchor(anchorIndices, currentAnchorIndex) {
  const position = anchorIndices.indexOf(currentAnchorIndex);
  if (position <= 0) return undefined;
  return anchorIndices[position - 1];
}

function getNextAnchor(anchorIndices, currentAnchorIndex) {
  const position = anchorIndices.indexOf(currentAnchorIndex);
  if (position < 0 || position >= anchorIndices.length - 1) return undefined;
  return anchorIndices[position + 1];
}

function formatTimestamp(timestamp) {
  const date = new Date(normalizeTimestamp(timestamp));
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

module.exports = {
  MessageMemoryStore
};
