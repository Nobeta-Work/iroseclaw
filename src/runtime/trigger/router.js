/**
 * Trigger Router
 * 标准化入口触发源，当前先覆盖消息触发
 */

const { isSameUid } = require('../../utils/uid');
const {
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId,
  getSessionMessageId
} = require('../../utils/session-metadata');

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function cleanMentionContent(content, botName) {
  let cleaned = typeof content === 'string' ? content : '';
  cleaned = cleaned.replace(/<at[^>]*\/>/gi, '');
  cleaned = cleaned.replace(/<at[^>]*>.*?<\/at>/gi, '');
  cleaned = cleaned.replace(/\[at:[^\]]+\]/gi, '');
  if (botName) {
    const escapedName = escapeRegExp(botName);
    cleaned = cleaned.replace(new RegExp(`@${escapedName}\\s*`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`^\\s*${escapedName}[\\s,，:：-]*`, 'i'), '');
  }
  return cleaned.trim();
}

class TriggerRouter {
  constructor(options = {}) {
    this.botProfile = options.botProfile || {};
    this.adminUids = Array.isArray(options.adminUids) ? [...options.adminUids] : [];
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
    const isMentioned = this._isMentioned(session, content, isPrivateSession, isAdminSender);
    const cleanedContent = isMentioned
      ? cleanMentionContent(content, this.botProfile?.name || '')
      : content.trim();

    if (isPrivateSession && !isAdminSender) {
      return {
        kind: 'message.private',
        shouldHandle: false,
        blockedReason: 'private_non_admin',
        isPrivateSession,
        isAdminSender,
        isMentioned: false,
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

  _isMentioned(session, content, isPrivateSession, isAdminSender) {
    const botUid = this.botProfile?.uid || '';
    const botName = this.botProfile?.name || '';

    if (isPrivateSession && isAdminSender) {
      return true;
    }

    if (session?.parsed?.appel) return true;
    if (botUid && content.includes(`id="${botUid}"`)) return true;
    if (botUid && content.includes(`<at id="${botUid}"`)) return true;
    if (botName && new RegExp(`@${botName}`, 'i').test(content)) return true;
    if (botName && content.trim().startsWith(botName)) return true;

    return false;
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
