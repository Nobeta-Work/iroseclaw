/**
 * Trigger Router
 * 标准化入口触发源，当前先覆盖消息触发
 */

const { isSameUid } = require('../../utils/uid');
const {
  escapeRegExp,
  isBotMentioned,
  cleanBotMentionContent
} = require('../../utils/bot-mention');
const {
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId,
  getSessionMessageId
} = require('../../utils/session-metadata');

function extractSessionTimestamp(session) {
  const candidates = [
    session?.timestamp,
    session?.event?.timestamp,
    session?.message?.timestamp
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(num);
    }
  }

  return Date.now();
}

function cleanMentionContent(content, botProfile = {}) {
  return cleanBotMentionContent(content, botProfile);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function isAsciiKeyword(keyword = '') {
  return /^[A-Za-z0-9_]+$/u.test(String(keyword || '').trim());
}

function isReferenceKeywordMatch(content = '', keyword = '') {
  const text = String(content || '');
  const normalizedKeyword = String(keyword || '').trim();
  if (!text || !normalizedKeyword) {
    return false;
  }

  if (!isAsciiKeyword(normalizedKeyword)) {
    return text.includes(normalizedKeyword);
  }

  const escaped = escapeRegExp(normalizedKeyword);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`, 'i');
  return pattern.test(text);
}

class TriggerRouter {
  constructor(options = {}) {
    this.botProfile = options.botProfile || {};
    this.adminUids = Array.isArray(options.adminUids) ? [...options.adminUids] : [];
    this.referenceKeywords = normalizeStringArray(options.referenceKeywords);
  }

  routeMessage(session) {
    const content = typeof session?.content === 'string' ? session.content : '';
    const userId = getSessionUserId(session);
    const username = getSessionUsername(session);
    const channelId = getSessionChannelId(session);
    const messageId = getSessionMessageId(session);
    const timestamp = extractSessionTimestamp(session);
    const isPrivateSession = typeof channelId === 'string' && channelId.startsWith('private:');
    const isAdminSender = this.adminUids.some(uid => isSameUid(uid, userId));
    const botUid = String(this.botProfile?.uid || '').trim();
    const isBotSelf = botUid && isSameUid(userId, botUid);
    const referenceKeyword = isBotSelf ? '' : this._findReferenceKeyword(content);
    const isReferenceTriggered = Boolean(referenceKeyword);
    const isMentioned = this._isMentioned(session, content, isPrivateSession, isAdminSender, isReferenceTriggered);
    const cleanedContent = isMentioned
      ? this._cleanTriggeredContent(content, {
          isReferenceTriggered,
          referenceKeyword,
          isPrivateSession,
          isAdminSender
        })
      : content.trim();

    if (isPrivateSession && !isAdminSender) {
      return {
        kind: 'message.private',
        shouldHandle: false,
        blockedReason: 'private_non_admin',
        isPrivateSession,
        isAdminSender,
        isMentioned: false,
        isReferenceTriggered,
        referenceKeyword,
        rawContent: content,
        cleanedContent,
        content,
        userId,
        username,
        channelId,
        messageId,
        timestamp,
        session
      };
    }

    if (isBotSelf) {
      return {
        kind: 'message.mentioned',
        shouldHandle: false,
        blockedReason: 'bot_self',
        isPrivateSession,
        isAdminSender,
        isMentioned: false,
        isReferenceTriggered: false,
        referenceKeyword: '',
        rawContent: content,
        cleanedContent,
        content,
        userId,
        username,
        channelId,
        messageId,
        timestamp,
        session
      };
    }

    return {
      kind: isPrivateSession ? 'message.private' : 'message.mentioned',
      shouldHandle: isMentioned,
      blockedReason: '',
      isPrivateSession,
        isAdminSender,
        isMentioned,
        isReferenceTriggered,
        referenceKeyword,
        rawContent: content,
      cleanedContent,
      content,
      userId,
      username,
      channelId,
      messageId,
      timestamp,
      session
    };
  }

  routePlatformEvent(eventName, session, data = {}) {
    const userId = getSessionUserId(session) || normalizeEventUserId(data);
    const username = getSessionUsername(session) || normalizeEventUsername(data);
    const channelId = getSessionChannelId(session) || normalizeEventChannelId(data);
    const messageId = getSessionMessageId(session);
    const timestamp = extractSessionTimestamp(session);

    return {
      kind: EVENT_KIND_MAP[eventName] || normalizeEventKind(eventName),
      shouldHandle: true,
      blockedReason: '',
      isPrivateSession: false,
      isAdminSender: false,
      isMentioned: false,
      rawContent: '',
      cleanedContent: '',
      content: '',
      userId,
      username,
      channelId,
      messageId,
      timestamp,
      eventName,
      eventData: data && typeof data === 'object' ? { ...data } : {},
      session
    };
  }

  _findReferenceKeyword(content) {
    for (const keyword of this.referenceKeywords) {
      if (isReferenceKeywordMatch(content, keyword)) {
        return keyword;
      }
    }
    return '';
  }

  _cleanTriggeredContent(content, options = {}) {
    const text = cleanMentionContent(content, this.botProfile);
    if (options.isReferenceTriggered !== true) {
      return text;
    }

    const keyword = String(options.referenceKeyword || '').trim();
    if (!keyword) {
      return text;
    }

    const escaped = escapeRegExp(keyword);
    const removed = text
      .replace(new RegExp(`^${escaped}[\\s,，:：-]*`, 'i'), '')
      .trim();
    return removed || text;
  }

  _isMentioned(session, content, isPrivateSession, isAdminSender, isReferenceTriggered = false) {
    if (isPrivateSession && isAdminSender) {
      return true;
    }
    if (isReferenceTriggered) {
      return true;
    }

    return isBotMentioned(session, content, this.botProfile);
  }
}

const EVENT_KIND_MAP = {
  'iirose/guild-member-switchRoom': 'iirose.switch_room',
  'iirose/payment': 'iirose.payment',
  'iirose/follower': 'iirose.follower',
  'iirose/broadcast': 'iirose.broadcast',
  'iirose/music-play': 'iirose.music_play',
  'iirose/roomNotice': 'iirose.room_notice'
};

function normalizeEventKind(eventName) {
  const text = String(eventName || '').trim();
  if (!text) return 'event.unknown';
  return text.toLowerCase().replace(/\//g, '.').replace(/[^a-z0-9._-]+/g, '_');
}

function normalizeEventUserId(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.uid || data.userId || '').trim();
}

function normalizeEventUsername(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.username || data.name || '').trim();
}

function normalizeEventChannelId(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.room || data.roomId || data.targetRoom || '').trim();
}

module.exports = {
  TriggerRouter,
  cleanMentionContent,
  extractSessionTimestamp,
  EVENT_KIND_MAP
};
