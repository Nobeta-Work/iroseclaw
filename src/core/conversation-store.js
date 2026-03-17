/**
 * Conversation Store
 * 按频道记录消息流，并围绕 @bot 锚点构建上下文
 */

class ConversationStore {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      maxEventsPerChannel: toPositiveInt(config.maxEventsPerChannel, 240),
      anchorLookBehind: toPositiveInt(config.anchorLookBehind, 10),
      anchorLookAhead: toPositiveInt(config.anchorLookAhead, 10),
      detailedAnchorCount: toPositiveInt(config.detailedAnchorCount, 3),
      summaryAnchorCount: toPositiveInt(config.summaryAnchorCount, 6),
      maxMessageChars: toPositiveInt(config.maxMessageChars, 180),
      maxSummaryChars: toPositiveInt(config.maxSummaryChars, 220)
    };
    this.channels = new Map();
    this.sequence = 0;
  }

  addUserMessage(input = {}) {
    return this._appendEvent({
      channelId: normalizeChannelId(input.channelId),
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
      channelId: normalizeChannelId(input.channelId),
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
    const channelId = normalizeChannelId(input.channelId);
    const triggerUserId = normalizeText(input.userId, 80) || 'unknown';
    const triggerUsername = normalizeText(input.username, 80) || '未知用户';
    const state = this.channels.get(channelId);

    const fallback = {
      triggerUser: {
        id: triggerUserId,
        name: triggerUsername
      },
      currentMessage: {
        userId: triggerUserId,
        username: triggerUsername,
        content: normalizeContent(input.currentContent, this.config.maxMessageChars),
        timestamp: normalizeTimestamp(input.timestamp)
      },
      recentMessages: [],
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

    const anchorIndices = [];
    for (let i = 0; i <= currentIndex; i++) {
      const event = state.events[i];
      if (event.role === 'user' && event.isMentionBot) {
        anchorIndices.push(i);
      }
    }

    if (anchorIndices.length === 0) {
      return {
        ...fallback,
        currentMessage
      };
    }

    const detailedAnchorIndices = anchorIndices.slice(-this.config.detailedAnchorCount);
    const summaryAnchorIndices = anchorIndices
      .slice(0, Math.max(0, anchorIndices.length - detailedAnchorIndices.length))
      .slice(-this.config.summaryAnchorCount);

    const ranges = detailedAnchorIndices
      .map((anchorIndex) => this._buildAnchorRange(state.events, anchorIndices, anchorIndex, currentIndex))
      .filter(Boolean);

    const mergedRanges = mergeRanges(ranges);
    const recentMessages = [];
    for (const range of mergedRanges) {
      for (let i = range.start; i <= range.end; i++) {
        const event = state.events[i];
        if (!event || !event.content) continue;
        recentMessages.push(this._serializeEvent(event));
      }
    }

    const historySummary = summaryAnchorIndices
      .map((anchorIndex) => this._summarizeAnchor(state.events, anchorIndices, anchorIndex, currentIndex))
      .filter(Boolean);

    return {
      triggerUser: {
        id: triggerUserId,
        name: triggerUsername
      },
      currentMessage,
      recentMessages,
      historySummary,
      anchorCount: anchorIndices.length
    };
  }

  _appendEvent(event) {
    if (!this.config.enabled) return null;
    if (!event.channelId || !event.content) return null;

    const state = this._getChannelState(event.channelId);
    const stored = {
      ...event,
      id: ++this.sequence
    };

    state.events.push(stored);
    if (state.events.length > this.config.maxEventsPerChannel) {
      state.events.splice(0, state.events.length - this.config.maxEventsPerChannel);
    }

    return stored;
  }

  _getChannelState(channelId) {
    let state = this.channels.get(channelId);
    if (!state) {
      state = {
        events: []
      };
      this.channels.set(channelId, state);
    }
    return state;
  }

  _findCurrentIndex(events, currentEventId) {
    if (!currentEventId) {
      return events.length - 1;
    }

    const index = events.findIndex(event => event.id === currentEventId);
    return index >= 0 ? index : events.length - 1;
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

  _serializeEvent(event) {
    return {
      role: event.role,
      userId: event.userId,
      username: event.username,
      content: event.content,
      timestamp: event.timestamp,
      isMentionBot: event.isMentionBot
    };
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
    for (let i = anchorIndex + 1; i <= searchEnd; i++) {
      if (events[i]?.role === 'assistant' && events[i]?.content) {
        botReply = events[i].content;
        break;
      }
    }

    const timestampLabel = formatTimestamp(anchorEvent.timestamp);
    const anchorText = truncateText(anchorEvent.content, this.config.maxSummaryChars);
    const replyText = botReply ? truncateText(botReply, this.config.maxSummaryChars) : '未记录到机器人回复';
    return `${timestampLabel} ${anchorEvent.username}(uid=${anchorEvent.userId}) @bot: ${anchorText} | bot: ${replyText}`;
  }
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function normalizeChannelId(value) {
  const text = normalizeText(value, 120);
  return text || 'global';
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
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  return Date.now();
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
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
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
  ConversationStore
};
