/**
 * Message Handler
 * 消息处理总控模块
 */

const permission = require('./permission');
const protocol = require('./protocol');
const audit = require('./audit');
const { createFallbackPicker } = require('../utils/fallback');
const {
  getSourceSession,
  getSessionUserId,
  getSessionUsername,
  getSessionChannelId,
  getSessionMessageId
} = require('../utils/session-metadata');

function escapeRegExp(text) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 创建消息处理器
 * @param {Object} config - 配置对象
 * @param {Object} config.bot - 机器人配置
 * @param {string} config.bot.uid - 机器人 UID
 * @param {string} config.bot.name - 机器人名字
 * @param {number} config.rateLimit - 速率限制（每分钟请求数）
 * @param {Object} openclawAdapter - OpenClaw 适配器实例
 * @param {Object} skillManager - 技能管理器实例
 * @param {Object} [options] - 附加选项
 * @param {Function} [options.pickFallback] - 失败兜底取词函数
 * @param {Function} [options.getConversationContext] - 构建对话上下文
 * @returns {Function} handleMessage 函数
 */
function createMessageHandler(config, openclawAdapter, skillManager, options = {}) {
  // 速率限制追踪：Map<userId, { count, resetTime }>
  const rateLimitMap = new Map();
  
  const botUid = config.bot?.uid || '';
  const botName = config.bot?.name || '';
  const rateLimitPerMinute = config.rateLimit?.perMinute || 60;
  const pickFallback = typeof options.pickFallback === 'function'
    ? options.pickFallback
    : createFallbackPicker(config.fallbackResponses);
  const getConversationContext = typeof options.getConversationContext === 'function'
    ? options.getConversationContext
    : (() => ({}));

  /**
   * 检查速率限制
   * @param {string} userId - 用户 ID
   * @returns {boolean} 是否允许请求
   */
  function checkRateLimit(userId) {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 分钟
    const userRecord = rateLimitMap.get(userId);

    if (!userRecord || now > userRecord.resetTime) {
      // 新窗口
      rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (userRecord.count >= rateLimitPerMinute) {
      return false;
    }

    userRecord.count++;
    return true;
  }

  /**
   * 检测是否 @机器人
   * @param {Object} session - 会话对象
   * @param {string} content - 消息内容
   * @returns {boolean} 是否被@
   */
  function isBotMentioned(session, content) {
    // 优先级 0: 上游已确认被@
    if (session?.isBotMentioned === true) {
      return true;
    }

    // 优先级 1: session.parsed?.appel
    if (session.parsed?.appel) {
      return true;
    }

    // 优先级 2: 检查 content 中的 at 标签匹配 bot UID（IIROSE 新旧格式）
    if (botUid && typeof content === 'string') {
      const escapedUid = escapeRegExp(botUid);
      const atTagPatterns = [
        new RegExp(`\\[at:${escapedUid}\\]`, 'i'),
        new RegExp(`<at\\b[^>]*\\bid=["']?${escapedUid}["']?[^>]*\\/?>`, 'i'),
        new RegExp(`<at\\b[^>]*\\bid=["']?${escapedUid}["']?[^>]*>.*?<\\/at>`, 'i')
      ];

      for (const pattern of atTagPatterns) {
        if (pattern.test(content)) {
          return true;
        }
      }
    }

    // 优先级 3: 检查 @botName
    if (botName) {
      const escapedName = escapeRegExp(botName);
      const patterns = [
        new RegExp(`@${escapedName}\\s*`, 'i'),
        new RegExp(`@${escapedName}$`, 'i'),
        new RegExp(`^${escapedName}[\\s,，:：]`, 'i')
      ];
      
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 清理消息（移除 at 标签和@名字）
   * @param {string} content - 原始消息
   * @returns {string} 清理后的消息
   */
  function cleanMessage(content) {
    let cleaned = typeof content === 'string' ? content : '';

    // 移除 IIROSE <at .../> 与 <at ...>...</at>
    cleaned = cleaned.replace(/<at\b[^>]*\/>/gi, '');
    cleaned = cleaned.replace(/<at\b[^>]*>.*?<\/at>/gi, '');

    // 移除 [at:xxx] 标签（UID 可能包含字母）
    cleaned = cleaned.replace(/\[at:[^\]]+\]/gi, '');

    // 移除 @名字
    if (botName) {
      const escapedName = escapeRegExp(botName);
      cleaned = cleaned.replace(new RegExp(`@${escapedName}\\s*`, 'gi'), '');
    }

    // 移除其他@提及
    cleaned = cleaned.replace(/@\w+\s*/g, '');

    // 清理多余空白
    return cleaned.trim();
  }

  /**
   * 处理消息
   * @param {Object} session - 会话对象
   * @returns {Promise<string|null>} 回复文本或 null
   */
  async function handleMessage(session) {
    let resolvedUserId = 'unknown';

    try {
      const sourceSession = getSourceSession(session);

      // a) 从 session 提取 userId, username, content
      const userId = getSessionUserId(session) || 'unknown';
      resolvedUserId = userId;
      const username = getSessionUsername(session) || '未知用户';
      const channelId = getSessionChannelId(session);
      const messageId = getSessionMessageId(session);
      const content = session.rawContent || session.content || session.message || '';

      // b) 检测是否@机器人
      if (!isBotMentioned(session, content)) {
        return null; // 未被@，不处理
      }

      // c) 清理消息
      const cleanedContent = (typeof session.cleanedContent === 'string' && session.cleanedContent.trim())
        ? session.cleanedContent.trim()
        : cleanMessage(content);

      if (!cleanedContent) {
        return '嗯？你想说什么呀~(◕‿◕✿)';
      }

      // d) 速率限制检查
      if (!checkRateLimit(userId)) {
        audit.logEvent('rate_limit_exceeded', { userId, username, content: cleanedContent });
        return '请求过于频繁，请稍后再试。';
      }

      // e) 权限判定（调用 permission 模块）
      const isAdmin = permission.isAdmin(userId);
      const action = 'chat'; // 默认聊天动作
      const permResult = permission.checkPermission(userId, action);
      
      if (!permResult.allowed) {
        audit.logPermissionDenied(userId, action, permResult.reason);
        return '抱歉，您没有权限执行此操作。';
      }

      // f) 检测系统请求和危险内容
      const messageObj = { content: cleanedContent };
      const isSystemRequest = permission.detectSystemRequest(messageObj);
      const hasDangerousContent = permission.detectDangerousContent(messageObj);
      
      if (hasDangerousContent && !isAdmin) {
        audit.logEvent('dangerous_content_detected', { userId, username, content: cleanedContent });
        return '抱歉，无法处理包含敏感内容的请求。';
      }

      // g) 构建协议请求（调用 protocol.buildRequest）
      const permissionCtx = {
        isAdmin,
        isSystemRequest,
        isOverreach: false,
        allowedSkills: ['help', 'music', 'chat']
      };
      const conversationContext = getConversationContext({
        session,
        userId,
        username,
        cleanedContent
      }) || {};
      
      const protocolRequest = protocol.buildRequest(
        {
          userId,
          username,
          chatId: session.chatId || channelId || '',
          channelId: channelId || session.chatId || '',
          messageId,
          platform: session.platform || sourceSession.platform || 'iirose'
        },
        { content: cleanedContent, mentionIds: [], isBotMentioned: true },
        permissionCtx,
        conversationContext
      );

      // h) 调用 OpenClaw 子代理获取 JSON 响应
      const adapterResponse = await openclawAdapter.processMessage(protocolRequest);

      // i) 解析响应（调用 protocol.parseResponse）
      const response = protocol.parseResponse(adapterResponse);

      // j) 如果 isSkillCall 且有 skillName，调用 skillManager.execute
      let finalResponse = response.replyText;
      
      if (response.isSkillCall && response.skillName) {
        audit.logEvent('skill_call', {
          userId,
          username,
          skillName: response.skillName,
          skillArgs: response.skillArgs
        });
        
        const skillResult = await skillManager.execute(response.skillName, response.skillArgs, sourceSession);
        
        if (skillResult !== null && skillResult !== undefined) {
          finalResponse = skillResult;
        }
      }

      // k) 记录审计日志
      audit.logRequest(protocolRequest, {
        replyText: finalResponse,
        isOverreach: response.isOverreach,
        isSkillCall: response.isSkillCall,
        skillName: response.skillName,
        isSystemRequest: response.isSystemRequest
      });

      // l) 返回最终回复文本
      return finalResponse || null;

    } catch (error) {
      console.error('[MessageHandler] Error:', error.message);
      
      audit.logEvent('error', {
        userId: resolvedUserId,
        error: error.message,
        stack: error.stack
      });

      return pickFallback();
    }
  }

  return handleMessage;
}

module.exports = { createMessageHandler };
