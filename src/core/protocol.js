/**
 * JSON 协议模块
 * 定义请求构建与响应解析函数
 */

const { generateRequestId } = require('../utils/json-utils');

/**
 * 构建请求对象
 * @param {Object} session - 会话信息 { userId, chatId, messageId, platform }
 * @param {Object} message - 消息内容 { content, mentionIds, isBotMentioned }
 * @param {Object} permissionCtx - 权限上下文 { isAdmin, isSystemRequest, isOverreach, allowedSkills }
 * @returns {Object} - 完整的请求对象
 */
const buildRequest = (session, message, permissionCtx) => {
  return {
    requestId: generateRequestId(),
    timestamp: Date.now(),
    version: "1.0",
    session: {
      userId: session?.userId || '',
      chatId: session?.chatId || '',
      messageId: session?.messageId || '',
      platform: session?.platform || 'iirose'
    },
    message: {
      content: message?.content || '',
      mentionIds: message?.mentionIds || [],
      isBotMentioned: message?.isBotMentioned || false
    },
    permission: {
      isAdmin: permissionCtx?.isAdmin || false,
      isSystemRequest: permissionCtx?.isSystemRequest || false,
      isOverreach: permissionCtx?.isOverreach || false,
      allowedSkills: permissionCtx?.allowedSkills || []
    },
    context: {
      recentMessages: permissionCtx?.recentMessages || []
    }
  };
};

/**
 * 解析子代理返回的响应
 * 确保包含所有必要字段，缺失字段用默认值填充
 * @param {any} raw - 原始响应数据
 * @returns {Object} - 标准化的响应对象
 */
const parseResponse = (raw) => {
  const defaultResponse = {
    requestType: "chat",
    isOverreach: false,
    isSkillCall: false,
    skillName: null,
    skillArgs: null,
    isSystemRequest: false,
    shouldReply: true,
    replyText: "",
    replySegments: [],
    audit: {
      reason: "",
      blocked: false
    }
  };
  
  // 如果 raw 不是对象，返回默认值
  if (!raw || typeof raw !== 'object') {
    return defaultResponse;
  }
  
  // 合并默认值和实际值
  return {
    requestType: raw.requestType ?? defaultResponse.requestType,
    isOverreach: raw.isOverreach ?? defaultResponse.isOverreach,
    isSkillCall: raw.isSkillCall ?? defaultResponse.isSkillCall,
    skillName: raw.skillName ?? defaultResponse.skillName,
    skillArgs: raw.skillArgs ?? defaultResponse.skillArgs,
    isSystemRequest: raw.isSystemRequest ?? defaultResponse.isSystemRequest,
    shouldReply: raw.shouldReply ?? defaultResponse.shouldReply,
    replyText: raw.replyText ?? defaultResponse.replyText,
    replySegments: Array.isArray(raw.replySegments) ? raw.replySegments : defaultResponse.replySegments,
    audit: {
      reason: raw.audit?.reason ?? defaultResponse.audit.reason,
      blocked: raw.audit?.blocked ?? defaultResponse.audit.blocked
    }
  };
};

module.exports = {
  buildRequest,
  parseResponse
};
