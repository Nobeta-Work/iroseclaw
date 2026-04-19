/**
 * OpenClaw Adapter
 * 兼容 legacy chat / legacy workflow 语义；底层 transport 由 OpenClawAgentBridge 提供。
 */

const { createFallbackPicker, normalizeFallbackResponses } = require('../utils/fallback');
const { normalizeWorkflowStepDecision } = require('../contracts/workflow');
const { OpenClawAgentBridge } = require('../ai/providers/openclaw-agent-bridge');
const { compileWorkflowPrompt } = require('../runtime/workflow/prompt/compiler');
const { parseWorkflowDecisionText } = require('../runtime/workflow/decision/parser');
const { buildContextPrompt } = require('../runtime/workflow/prompt/serializers');

class OpenClawAdapter {
  /**
   * @param {Object} config - OpenClaw 配置
   * @param {string} [config.agentLabel] - OpenClaw transport agent 标签
   * @param {string} [config.subagentLabel] - 兼容旧字段，等价于 agentLabel
   * @param {number} config.timeout - 超时时间（毫秒）
   * @param {string[]} config.fallbackResponses - 备用响应列表
   * @param {Object} [config.meme] - 表情包情绪配置
   * @param {boolean} [config.meme.enabled] - 是否启用情绪标签注入
   * @param {boolean} [config.meme.requestEmotionTag] - 是否请求模型输出情绪标签
   */
  constructor(config) {
    const input = config && typeof config === 'object' ? config : {};
    const resolvedAgentLabel = input.agentLabel || input.subagentLabel || 'iirose-transport';
    this.config = {
      agentLabel: resolvedAgentLabel,
      // backward compatibility for old call sites/tests
      subagentLabel: resolvedAgentLabel,
      timeout: input.timeout || 30000,
      local: input.local !== false,
      stateless: input.stateless !== false,
      useNativeSessionContext: input.useNativeSessionContext === true,
      fallbackResponses: normalizeFallbackResponses(input.fallbackResponses),
      meme: {
        enabled: input?.meme?.enabled !== false,
        requestEmotionTag: input?.meme?.requestEmotionTag !== false
      },
      promptProfile: input?.promptProfile && typeof input.promptProfile === 'object'
        ? { ...input.promptProfile }
        : {},
      retry: {
        maxRetries: toPositiveInt(input?.retry?.maxRetries, 2),
        retryDelayMs: toPositiveInt(input?.retry?.retryDelayMs, 250)
      }
    };
    this.logger = input.logger || console;
    this.pickFallback = createFallbackPicker(this.config.fallbackResponses);
    this.sessionQueues = new Map();
    this.provider = input.provider || new OpenClawAgentBridge({
      agentLabel: this.config.agentLabel,
      timeout: this.config.timeout,
      local: this.config.local,
      stateless: this.config.stateless,
      thinking: input.thinking || '',
      isolatedStatePerRequest: input.isolatedStatePerRequest === true,
      cleanupStateDirAfterRequest: input.cleanupStateDirAfterRequest !== false,
      stateDirBase: input.stateDirBase,
      configPath: input.configPath,
      logger: input.logger || console
    });
  }

  _buildExecArgs(args = []) {
    if (typeof this.provider.buildExecArgs === 'function') {
      return this.provider.buildExecArgs(args);
    }
    return this.provider._buildExecArgs(args);
  }

  _resolveOpenClawInvocation() {
    if (typeof this.provider.resolveInvocation === 'function') {
      return this.provider.resolveInvocation();
    }
    return this.provider._resolveOpenClawInvocation();
  }

  _appendEmotionInstruction(message) {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return text;

    if (!this.config.meme.enabled || !this.config.meme.requestEmotionTag) {
      return text;
    }

    const instruction = [
      '请在回复末尾附加一个情绪标签，格式：[[EMO:情绪]]。',
      '情绪示例：开心、难过、生气、无语、疑惑、惊讶、调皮、安慰。',
      '除了该标签，不要输出其他解释。'
    ].join('');

    return `${text}\n\n${instruction}`;
  }

  _formatContextMessage(item) {
    if (!item || typeof item !== 'object') return '';
    const role = item.role === 'assistant'
      ? 'BOT'
      : `${item.username || '未知用户'}(uid=${item.userId || 'unknown'})`;
    const mentionLabel = item.isMentionBot ? ' @bot' : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) return '';
    return `- ${role}${mentionLabel}: ${content}`;
  }

  _buildPermissionPrompt(protocolRequest) {
    const permission = protocolRequest?.permission || {};
    const lines = [];

    if (permission.isAdmin === true) {
      lines.push('当前触发用户拥有管理员权限。');
      lines.push('在策略允许且工具可见的前提下，可以执行管理员级动作或按管理员身份回答。');
    } else {
      lines.push('当前触发用户不是管理员。');
      lines.push('不要暗示其拥有管理员级能力，也不要为其规划管理员专属动作。');
    }

    if (permission.isSystemRequest === true) {
      lines.push('当前消息包含系统/管理意图。请谨慎判断是否需要工具，而不是直接臆造执行结果。');
    }

    const allowedSkills = Array.isArray(permission.allowedSkills)
      ? permission.allowedSkills.filter(Boolean)
      : [];
    if (allowedSkills.length > 0) {
      lines.push(`当前权限上下文允许的 legacy actions/skills: ${allowedSkills.join(', ')}`);
    }

    return lines;
  }

  _buildContextPrompt(protocolRequest) {
    return buildContextPrompt(protocolRequest, {
      useNativeSessionContext: this.config.useNativeSessionContext === true
    });
  }

  _buildNativeContextPrompt(protocolRequest) {
    const triggerUser = protocolRequest?.context?.triggerUser || {};
    const currentMessage = protocolRequest?.context?.currentMessage || {};
    const currentContent = typeof currentMessage.content === 'string'
      ? currentMessage.content.trim()
      : (typeof protocolRequest?.message?.content === 'string' ? protocolRequest.message.content.trim() : '');

    const blocks = [
      '你正在 IIROSE 群聊环境中回复消息。',
      '必须使用 uid 区分用户，不能把同名用户视为同一人。',
      `当前房间: ${protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || 'unknown'}`,
      `当前触发用户: ${triggerUser.name || protocolRequest?.session?.username || '未知用户'} (uid=${triggerUser.id || protocolRequest?.session?.userId || 'unknown'})`,
      '同一 session 的历史消息由系统自动保留，不需要你重复复述上下文，也不要臆造不存在的历史。'
    ];
    blocks.push(...this._buildPermissionPrompt(protocolRequest));

    if (currentContent) {
      blocks.push(`当前需要回复的消息: ${(currentMessage.username || triggerUser.name || '未知用户')}(uid=${currentMessage.userId || triggerUser.id || 'unknown'}): ${currentContent}`);
    }

    blocks.push('请只回复当前消息，保持自然、简短、直接。');
    return blocks.join('\n');
  }

  /**
   * 随机选择备用响应
   * @returns {string} 备用响应文本
   */
  _getRandomFallback() {
    return this.pickFallback();
  }

  /**
   * 构建协议兼容响应对象
   * @param {string} replyText - 回复文本
   * @param {string} reason - 审计原因
   * @returns {Object}
   */
  _buildProtocolResponse(replyText, reason = '') {
    return {
      requestType: 'chat',
      isOverreach: false,
      isSkillCall: false,
      skillName: null,
      skillArgs: null,
      isSystemRequest: false,
      shouldReply: true,
      replyText: replyText,
      replySegments: [],
      audit: {
        reason,
        blocked: false
      }
    };
  }

  _sanitizeSessionId(value, fallback = 'irose-chat') {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const normalized = text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120);
    return normalized || fallback;
  }

  _buildConversationSessionId(protocolRequest) {
    if (!this.config.useNativeSessionContext) {
      return this._sanitizeSessionId(
        `irose-request-${protocolRequest?.requestId || protocolRequest?.session?.messageId || Date.now()}`
      );
    }

    const channelId = protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || '';
    const userId = protocolRequest?.session?.userId || '';
    const scope = channelId || userId || protocolRequest?.requestId || 'global';
    return this._sanitizeSessionId(`irose-session-${scope}`);
  }

  _buildSessionQueueKey(protocolRequest = {}) {
    const channelId = protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || '';
    const userId = protocolRequest?.session?.userId || '';
    const scope = channelId || userId || 'global';
    if (this.config.useNativeSessionContext) {
      return this._sanitizeSessionId(`irose-session-${scope}`);
    }
    return this._sanitizeSessionId(`irose-queue-${scope}`);
  }

  _buildCommandArgs(protocolRequest, messageContent) {
    return this.provider.buildAgentArgs({
      agentLabel: this.config.agentLabel,
      message: messageContent,
      timeoutMs: this.config.timeout,
      sessionId: this._buildConversationSessionId(protocolRequest),
      statefulSession: this.config.useNativeSessionContext === true,
      local: this.config.local,
      json: false
    });
  }

  _buildWorkflowPrompt(workflowInput = {}) {
    return compileWorkflowPrompt(workflowInput, {
      contextPrompt: this._buildContextPrompt(workflowInput.protocolRequest || {}),
      meme: this.config.meme,
      promptProfile: this.config.promptProfile || {}
    }).prompt;
  }

  _parseWorkflowDecisionText(text) {
    const parsed = parseWorkflowDecisionText(text);
    return parsed.ok ? parsed.decision : null;
  }

  async _runInSessionQueue(protocolRequest, task) {
    const queueKey = this._buildSessionQueueKey(protocolRequest);
    const previous = this.sessionQueues.get(queueKey) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task);

    this.sessionQueues.set(queueKey, current);

    try {
      return await current;
    } finally {
      if (this.sessionQueues.get(queueKey) === current) {
        this.sessionQueues.delete(queueKey);
      }
    }
  }

  /**
   * 从 OpenClaw JSON 输出中提取文本
   * @param {string} stdout - 标准输出
   * @returns {string}
   */
  _extractReplyTextFromJson(stdout) {
    if (typeof this.provider.extractTextFromJson === 'function') {
      return this.provider.extractTextFromJson(stdout);
    }
    return this.provider._extractTextFromJson(stdout);
  }

  /**
   * 从普通文本输出中提取回复
   * @param {string} stdout - 标准输出
   * @returns {string}
   */
  _extractReplyTextFromPlain(stdout) {
    if (typeof this.provider.extractTextFromPlain === 'function') {
      return this.provider.extractTextFromPlain(stdout);
    }
    return this.provider._extractTextFromPlain(stdout);
  }

  /**
   * 归一化错误信息，便于审计
   * @param {Error} error - 错误对象
   * @returns {string}
   */
  _formatErrorReason(error) {
    if (typeof this.provider.formatErrorReason === 'function') {
      return this.provider.formatErrorReason(error);
    }
    return this.provider._formatErrorReason(error);
  }

  _looksLikeProviderErrorText(text = '') {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) return false;
    return (
      normalized.startsWith('http 4') ||
      normalized.startsWith('http 5') ||
      normalized.startsWith('error:') ||
      normalized.includes('all models failed') ||
      normalized.includes('range of input length should be') ||
      normalized.includes('request was aborted') ||
      normalized.includes('timed out') ||
      normalized.includes('timeout') ||
      normalized.includes('spawn openclaw') ||
      normalized.includes('enoent') ||
      normalized.includes('config invalid') ||
      normalized.includes('invalid config')
    );
  }

  _isRetryableProviderError(errorText = '') {
    const normalized = String(errorText || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('enoent') || normalized.includes('config invalid') || normalized.includes('invalid config')) {
      return false;
    }
    return (
      normalized.includes('timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('request was aborted') ||
      normalized.includes('econnreset') ||
      normalized.includes('econnrefused') ||
      normalized.includes('gateway') ||
      normalized.includes('http 429') ||
      normalized.includes('http 5')
    );
  }

  async _sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async _completeWithRetry(input = {}, contextMeta = {}) {
    const maxRetries = this.config.retry.maxRetries;
    const retryDelayMs = this.config.retry.retryDelayMs;
    let lastResult = null;
    let attemptsUsed = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attemptsUsed = attempt;
      const result = await this.provider.complete(input);
      lastResult = result;
      if (result?.ok !== false) {
        return {
          result,
          retryCount: attempt
        };
      }

      const reason = result?.error || '';
      const shouldRetry = attempt < maxRetries && this._isRetryableProviderError(reason);
      if (!shouldRetry) {
        break;
      }

      this.logger.warn?.(
        `[OpenClawAdapter] retrying provider attempt=${attempt + 1} requestId=${contextMeta.requestId || ''} session=${contextMeta.sessionId || ''} reason=${reason}`
      );
      await this._sleep(retryDelayMs * (attempt + 1));
    }

    return {
      result: lastResult,
      retryCount: attemptsUsed
    };
  }

  /**
   * 处理消息 - 调用 OpenClaw 子代理
   * @param {Object} protocolRequest - 协议请求对象
   * @returns {Promise<Object>} 解析后的响应（兼容 protocol.parseResponse）
   */
  async processMessage(protocolRequest) {
    return this._runInSessionQueue(protocolRequest, async () => {
      const messageContent = this._appendEmotionInstruction(this._buildContextPrompt(protocolRequest));
      if (!messageContent) {
        return this._buildProtocolResponse(this._getRandomFallback(), 'empty message content');
      }

      const { result } = await this._completeWithRetry({
        agentLabel: this.config.agentLabel,
        message: messageContent,
        timeoutMs: this.config.timeout,
        sessionId: this._buildConversationSessionId(protocolRequest),
        statefulSession: this.config.useNativeSessionContext === true,
        local: this.config.local,
        json: true
      }, {
        requestId: protocolRequest?.requestId || '',
        sessionId: protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || ''
      });

      if (result.jsonText) {
        return this._buildProtocolResponse(result.jsonText);
      }

      if (!result.ok) {
        const reason = result.error || 'unknown error';
        this.logger.error?.('[OpenClawAdapter] Error processing message:', reason);
        return this._buildProtocolResponse(this._getRandomFallback(), reason);
      }

      this.logger.error?.('[OpenClawAdapter] Error processing message:', 'OpenClaw output did not contain reply text.');
      return this._buildProtocolResponse(
        this._getRandomFallback(),
        'OpenClaw output did not contain reply text.'
      );
    });
  }

  async processWorkflowStep(workflowInput = {}) {
    const protocolRequest = workflowInput.protocolRequest || {};

    return this._runInSessionQueue(protocolRequest, async () => {
      const prompt = this._buildWorkflowPrompt(workflowInput);

      if (!prompt) {
        return normalizeWorkflowStepDecision({
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: this._getRandomFallback(),
            replySegments: []
          },
          audit: {
            reason: 'empty workflow prompt',
            blocked: false
          }
        });
      }

      const { result, retryCount } = await this._completeWithRetry({
        agentLabel: this.config.agentLabel,
        message: prompt,
        timeoutMs: this.config.timeout,
        sessionId: this._buildConversationSessionId(protocolRequest),
        statefulSession: this.config.useNativeSessionContext === true,
        local: this.config.local,
        json: true
      }, {
        requestId: protocolRequest?.requestId || '',
        sessionId: protocolRequest?.session?.channelId || protocolRequest?.session?.chatId || ''
      });
      const rawReply = result.jsonText || result.plainText || '';
      if (!result.ok) {
        return normalizeWorkflowStepDecision({
          status: 'error',
          audit: {
            reason: `provider error: ${result.error || 'unknown error'}`,
            blocked: false,
            retryCount
          }
        });
      }

      const decision = this._parseWorkflowDecisionText(rawReply);
      if (decision) {
        decision.audit = {
          ...(decision.audit || {}),
          retryCount
        };
        return decision;
      }

      if (this._looksLikeProviderErrorText(rawReply)) {
        return normalizeWorkflowStepDecision({
          status: 'error',
          audit: {
            reason: `provider error text: ${rawReply.slice(0, 600)}`,
            blocked: false,
            retryCount
          }
        });
      }

      return normalizeWorkflowStepDecision({
        status: 'final',
        finalOutput: {
          mode: 'reply',
          text: rawReply || this._getRandomFallback(),
          replySegments: []
        },
        audit: {
          reason: 'decision_parse_fallback',
          blocked: false,
          retryCount
        }
      });
    });
  }
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

module.exports = { OpenClawAdapter };
