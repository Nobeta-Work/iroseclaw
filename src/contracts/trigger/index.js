/**
 * Trigger contract
 * 统一 workflow 触发源结构
 */

const { generateRequestId } = require('../../utils/json-utils');

function normalizeSession(session = {}) {
  return {
    platform: typeof session.platform === 'string' && session.platform.trim()
      ? session.platform.trim()
      : 'iirose',
    channelId: typeof session.channelId === 'string' ? session.channelId : '',
    userId: typeof session.userId === 'string' ? session.userId : '',
    username: typeof session.username === 'string' ? session.username : '',
    messageId: typeof session.messageId === 'string' ? session.messageId : ''
  };
}

function createTriggerEnvelope(input = {}) {
  const session = normalizeSession(input.session);
  const timestamp = Number(input.timestamp);

  return {
    triggerId: typeof input.triggerId === 'string' && input.triggerId.trim()
      ? input.triggerId.trim()
      : `trigger_${generateRequestId()}`,
    kind: typeof input.kind === 'string' && input.kind.trim()
      ? input.kind.trim()
      : 'message.mentioned',
    platform: typeof input.platform === 'string' && input.platform.trim()
      ? input.platform.trim()
      : session.platform,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now(),
    session,
    payload: input.payload && typeof input.payload === 'object' ? { ...input.payload } : {},
    source: input.source && typeof input.source === 'object' ? { ...input.source } : {}
  };
}

module.exports = {
  createTriggerEnvelope
};
