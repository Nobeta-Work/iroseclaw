/**
 * Chat protocol request builder for workflow runtime
 */

const protocol = require('../../core/protocol');
const { isAdminUser, checkConfiguredActionPermission } = require('../policy/access');
const { detectSystemRequest, detectDangerousContent } = require('../policy/content');

function buildChatProtocolRequest(input = {}) {
  const userId = input.userId || 'unknown';
  const username = input.username || '未知用户';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const availableSkills = Array.isArray(input.availableSkills) ? [...input.availableSkills] : [];
  const runtimeConfig = input.runtimeConfig && typeof input.runtimeConfig === 'object' ? input.runtimeConfig : {};
  const isPrivate = input.isPrivate === true || (input.channelId || '').startsWith('private:');

  const action = 'chat';
  // 私聊且用户在 adminUids 中时，直接视为管理员
  const isAdmin = isPrivate && Array.isArray(runtimeConfig.adminUids) && runtimeConfig.adminUids.some(uid => uid === userId)
    || isAdminUser(runtimeConfig, userId);
  const permResult = checkConfiguredActionPermission(runtimeConfig, userId, action);
  if (!permResult.allowed) {
    return {
      ok: false,
      replyText: '抱歉，您没有权限执行此操作。'
    };
  }

  const isSystemRequest = detectSystemRequest(content);
  const hasDangerousContent = detectDangerousContent(content);
  if (hasDangerousContent && !isAdmin) {
    return {
      ok: false,
      replyText: '抱歉，无法处理包含敏感内容的请求。'
    };
  }

  return {
    ok: true,
    protocolRequest: protocol.buildRequest(
      {
        userId,
        username,
        chatId: input.chatId || input.channelId || '',
        channelId: input.channelId || input.chatId || '',
        messageId: input.messageId || '',
        platform: input.platform || 'iirose'
      },
      {
        content,
        mentionIds: [],
        isBotMentioned: true
      },
      {
        isAdmin,
        isSystemRequest,
        isOverreach: false,
        allowedSkills: availableSkills
      },
      input.conversationContext || {}
    )
  };
}

module.exports = {
  buildChatProtocolRequest
};
