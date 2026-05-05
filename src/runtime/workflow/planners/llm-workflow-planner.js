/**
 * LLM workflow planner
 * 使用 provider + framework prompt/decision 协议产出下一步 workflow 决策。
 */

const {
  normalizeWorkflowStepDecision,
  isSilentReplyToken
} = require('../../../contracts/workflow');
const { BaseWorkflowPlanner } = require('./base-planner');
const {
  compileWorkflowPrompt,
  buildPromptProfileLines,
  resolvePromptProfile
} = require('../prompt/compiler');
const { parseWorkflowDecisionText } = require('../decision/parser');
const { buildContextPrompt } = require('../prompt/serializers');
const { containsMarkdownCodeFence } = require('../../../utils/iirose-markdown');

function normalizeProviderName(providerName = '') {
  return String(providerName || '').trim().toLowerCase();
}

function looksLikeProviderErrorText(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith('http 4') ||
    normalized.startsWith('http 5') ||
    normalized.startsWith('error:') ||
    normalized.includes('all models failed') ||
    normalized.includes('range of input length should be') ||
    normalized.includes('request was aborted') ||
    normalized.includes('llm request timed out') ||
    normalized.includes('copilot token exchange failed') ||
    normalized.includes('internalerror.')
  );
}

function normalizeProviderFailureReason(reason = '') {
  const text = String(reason || '').trim();
  if (!text) {
    return 'provider returned empty output';
  }

  const normalized = text.toLowerCase();
  if (
    normalized.startsWith('provider returned ') ||
    normalized.startsWith('provider error:') ||
    normalized.startsWith('provider error text:')
  ) {
    return text;
  }

  return `provider error: ${text}`;
}

function getCurrentRequestText(input = {}) {
  const candidates = [
    input?.trigger?.payload?.content,
    input?.protocolRequest?.message?.content,
    input?.protocolRequest?.context?.currentMessage?.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function normalizeCompactText(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function looksLikeMarkdownIntent(text = '') {
  return /(markdown|md格式|markdown格式|代码块|code\s*block|```)/i.test(String(text || ''));
}

function looksLikeCodeIntent(text = '') {
  return /((代码|程序|脚本|示例|示例代码|代码示例|snippet|demo).{0,8}(python|py|java|javascript|js|typescript|ts|go|golang|rust|sql|bash|shell|html|css|json|yaml|xml|c\+\+|c#)?)|(\bpython\b|\bjava\b|\bjavascript\b|\bjs\b|\btypescript\b|\bts\b|\bgo\b|\bgolang\b|\brust\b|\bsql\b|\bbash\b|\bshell\b|\bhtml\b|\bcss\b|\bjson\b|\byaml\b|\bxml\b|c\+\+|c#)/i.test(String(text || ''));
}

function inferRenderMode(replyText = '', input = {}) {
  if (containsMarkdownCodeFence(replyText)) {
    return 'markdown';
  }

  const requestText = getCurrentRequestText(input);
  if (looksLikeMarkdownIntent(requestText) && String(replyText || '').includes('\n')) {
    return 'markdown';
  }

  return 'plain';
}

function shouldBypassStructuredDecision(decision = {}, input = {}) {
  const requestText = getCurrentRequestText(input);
  const wantsCode = looksLikeCodeIntent(requestText);
  const wantsMarkdown = looksLikeMarkdownIntent(requestText);
  if (!wantsCode && !wantsMarkdown) {
    return false;
  }

  if (decision.status === 'needs_tools') {
    return true;
  }

  if (decision.status !== 'final') {
    return false;
  }

  if (String(decision.finalOutput?.mode || '').trim().toLowerCase() === 'none') {
    return false;
  }

  const replyText = typeof decision.finalOutput?.text === 'string' ? decision.finalOutput.text.trim() : '';
  if (!replyText) {
    return true;
  }

  if (containsMarkdownCodeFence(replyText)) {
    return false;
  }

  const compactReply = normalizeCompactText(replyText);
  const compactRequest = normalizeCompactText(requestText);
  const likelyEcho = compactRequest
    && (compactReply === compactRequest
      || (compactReply.includes(compactRequest) && compactReply.length <= compactRequest.length + 12));

  if (wantsCode && decision.finalOutput?.renderMode !== 'markdown') {
    return true;
  }

  if (wantsCode) {
    return true;
  }

  return likelyEcho;
}

class LlmWorkflowPlanner extends BaseWorkflowPlanner {
  constructor(options = {}) {
    super(options);
    this.provider = options.provider || null;
    this.promptCompiler = typeof options.promptCompiler === 'function'
      ? options.promptCompiler
      : compileWorkflowPrompt;
    this.logger = options.logger || console;
    this.config = options.config && typeof options.config === 'object' ? options.config : {};
    this.label = options.label || 'llm-default';
  }

  _buildDirectReplyPrompt(input = {}) {
    const protocolRequest = input.protocolRequest || {};
    const contextPrompt = buildContextPrompt(protocolRequest, {
      useNativeSessionContext: this.config.useNativeSessionContext === true
    });
    const currentRequest = getCurrentRequestText(input);
    const promptProfile = resolvePromptProfile(input, {
      promptProfile: this.config.promptProfile || {},
      promptProfileService: this.config.promptProfileService || null
    });
    const lines = [
      contextPrompt,
      ''
    ];

    lines.push(...buildPromptProfileLines(promptProfile), '');
    lines.push(
      '现在切换到直接回复模式。',
      '不要输出 JSON，不要描述工具调用，不要解释系统内部执行过程。',
      '直接输出将要发给用户的最终回复内容。'
    );

    if (looksLikeCodeIntent(currentRequest) || looksLikeMarkdownIntent(currentRequest)) {
      lines.push('如果用户要求代码、代码块或 markdown，请直接使用 markdown 回复。');
      lines.push('当输出代码时，必须放在三反引号代码块中，并尽量给出最小可运行示例。');
    } else {
      lines.push('保持自然、直接、贴近当前上下文。');
    }

    return lines.join('\n');
  }

  _buildDirectReplyDecision(replyText = '', input = {}, providerName = '', reason = 'decision_parse_fallback') {
    return normalizeWorkflowStepDecision({
      status: 'final',
      finalOutput: {
        mode: 'reply',
        text: replyText,
        renderMode: inferRenderMode(replyText, input),
        replySegments: []
      },
      audit: {
        reason,
        blocked: false,
        planner: this.label,
        provider: providerName
      }
    });
  }

  _buildSilentDecision(providerName = '', reason = 'silent reply token') {
    return normalizeWorkflowStepDecision({
      status: 'final',
      finalOutput: {
        mode: 'none',
        text: '',
        renderMode: 'plain',
        replySegments: [],
        operations: []
      },
      audit: {
        reason,
        blocked: false,
        planner: this.label,
        provider: providerName
      }
    });
  }

  async _attemptDirectReplyFallback(input = {}, providerName = '', reason = 'agent_reply_fallback') {
    let result = null;
    let replyText = '';
    let replyProvider = providerName;
    const maxRetries = this._getMaxRetries(providerName || this._getProviderName({}));

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      result = await this.provider.complete({
        message: this._buildDirectReplyPrompt(input),
        timeoutMs: this.config.timeoutMs,
        json: false
      });
      replyText = this._getDecisionText(result).trim();
      replyProvider = this._getProviderName(result) || providerName;
      if (result?.ok !== false && isSilentReplyToken(replyText)) {
        return {
          ok: true,
          decision: this._buildSilentDecision(replyProvider, 'silent reply token'),
          providerName: replyProvider
        };
      }
      const retryableFailure = result?.ok === false || looksLikeProviderErrorText(replyText);
      if (!retryableFailure || attempt >= maxRetries) {
        break;
      }

      this.logger.warn?.(
        `[LlmWorkflowPlanner] retrying direct reply fallback after attempt ${attempt + 1}: ${result?.error || replyText.slice(0, 160)}`
      );
    }

    if (!result?.ok) {
      return {
        ok: false,
        providerName: replyProvider,
        reason: normalizeProviderFailureReason(result?.error)
      };
    }

    if (!replyText || looksLikeProviderErrorText(replyText)) {
      return {
        ok: false,
        providerName: replyProvider,
        reason: replyText
          ? `provider error text: ${replyText.slice(0, 600)}`
          : 'empty direct reply fallback output'
      };
    }

    return {
      ok: true,
      decision: this._buildDirectReplyDecision(replyText, input, replyProvider, reason),
      providerName: replyProvider
    };
  }

  _getProviderName(result = {}) {
    return result?.provider
      || this.provider?.label
      || this.provider?.provider
      || this.provider?.constructor?.name
      || '';
  }

  _getDecisionText(result = {}) {
    return result?.text || result?.jsonText || result?.plainText || '';
  }

  _getMaxRetries(providerName = '') {
    const configured = Number.isFinite(Number(this.config.maxProviderRetries))
      ? Math.max(0, Math.floor(Number(this.config.maxProviderRetries)))
      : null;

    if (configured != null) {
      return configured;
    }

    return normalizeProviderName(providerName) ? 2 : 2;
  }

  _shouldRetry(result, parsed, providerName, attempt, maxRetries) {
    if (attempt >= maxRetries) {
      return false;
    }

    if (result?.ok === false) {
      return true;
    }

    const decisionText = this._getDecisionText(result);
    return looksLikeProviderErrorText(decisionText) || looksLikeProviderErrorText(result?.raw?.stdout || '');
  }

  async decideNextStep(input = {}) {
    if (!this.provider || typeof this.provider.complete !== 'function') {
      return normalizeWorkflowStepDecision({
        status: 'error',
        audit: {
          reason: 'workflow model provider is not configured',
          blocked: false,
          planner: this.label,
          provider: ''
        }
      });
    }

    const compiled = this.promptCompiler(input, {
      useNativeSessionContext: this.config.useNativeSessionContext === true,
      meme: this.config.meme || {},
      promptProfile: this.config.promptProfile || {},
      promptProfileService: this.config.promptProfileService || null
    });
    const prompt = compiled?.prompt || compiled?.userPrompt || '';
    if (!prompt) {
      return normalizeWorkflowStepDecision({
        status: 'error',
        audit: {
          reason: 'workflow prompt compiler returned empty prompt',
          blocked: false,
          planner: this.label,
          provider: this.provider.label || this.provider.provider || this.provider.constructor?.name || ''
        }
      });
    }

    let lastResult = null;
    let lastParsed = null;
    let providerName = '';
    let lastFailureReason = '';
    let lastFailureProviderName = '';
    const fallbackProviderName = this._getProviderName({});
    const maxRetries = this._getMaxRetries(fallbackProviderName);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await this.provider.complete({
        ...compiled,
        message: prompt,
        timeoutMs: this.config.timeoutMs,
        json: true
      });

      providerName = this._getProviderName(result);
      const decisionText = this._getDecisionText(result);
      if (result?.ok !== false && isSilentReplyToken(decisionText)) {
        return this._buildSilentDecision(providerName, 'silent reply token');
      }
      const parsed = parseWorkflowDecisionText(decisionText);
      const providerFailureReason = result?.ok === false
        ? normalizeProviderFailureReason(result.error)
        : (looksLikeProviderErrorText(decisionText) || looksLikeProviderErrorText(result?.raw?.stdout || '')
          ? `provider error text: ${decisionText.slice(0, 600)}`
          : '');
      if (providerFailureReason) {
        lastFailureReason = providerFailureReason;
        lastFailureProviderName = providerName || fallbackProviderName;
      }

      if (parsed.ok && parsed.decision) {
        const normalizedDecision = normalizeWorkflowStepDecision({
          ...parsed.decision,
          audit: {
            ...(parsed.decision.audit || {}),
            planner: this.label,
            provider: providerName
          }
        });

        if (shouldBypassStructuredDecision(normalizedDecision, input)) {
          this.logger.warn?.(
            `[LlmWorkflowPlanner] bypassing structured decision for direct reply fallback: status=${normalizedDecision.status}`
          );
          const fallbackReply = await this._attemptDirectReplyFallback(input, providerName, 'agent_reply_fallback');
          if (fallbackReply.ok && fallbackReply.decision) {
            return fallbackReply.decision;
          }

          if (normalizedDecision.status === 'needs_tools') {
            return normalizeWorkflowStepDecision({
              status: 'error',
              audit: {
                reason: fallbackReply.reason || 'agent reply fallback failed after suspicious tool decision',
                blocked: false,
                planner: this.label,
                provider: fallbackReply.providerName || providerName
              }
            });
          }
        }

        return normalizedDecision;
      }

      lastResult = result;
      lastParsed = parsed;

      if (this._shouldRetry(result, parsed, providerName, attempt, maxRetries)) {
        const retryReason = result?.ok === false
          ? normalizeProviderFailureReason(result.error)
          : `invalid workflow decision: ${parsed.error || 'empty response'}`;
        this.logger.warn?.(
          `[LlmWorkflowPlanner] retrying provider after attempt ${attempt + 1}: ${retryReason}`
        );
        continue;
      }

      break;
    }

    const nonJsonReply = this._getDecisionText(lastResult).trim();
    if (nonJsonReply && !looksLikeProviderErrorText(nonJsonReply)) {
      const requestText = getCurrentRequestText(input);
      if (looksLikeCodeIntent(requestText) || looksLikeMarkdownIntent(requestText)) {
        this.logger.warn?.('[LlmWorkflowPlanner] decision parse fallback to direct final reply');
        const fallbackReply = await this._attemptDirectReplyFallback(
          input,
          providerName || fallbackProviderName,
          'decision_parse_fallback'
        );
        if (fallbackReply.ok && fallbackReply.decision) {
          return fallbackReply.decision;
        }

        return normalizeWorkflowStepDecision({
          status: 'error',
          audit: {
            reason: 'invalid workflow decision: decision parse fallback failed',
            blocked: false,
            planner: this.label,
            provider: fallbackReply.providerName || providerName || fallbackProviderName
          }
        });
      }

      this.logger.warn?.('[LlmWorkflowPlanner] decision parse fallback to raw final reply');
      return this._buildDirectReplyDecision(
        nonJsonReply,
        input,
        providerName || fallbackProviderName,
        'decision_parse_fallback'
      );
    }

    const reason = lastFailureReason || (
      lastResult?.ok === false
        ? normalizeProviderFailureReason(lastResult.error)
        : `invalid workflow decision: ${lastParsed?.error || 'empty response'}`
    );
    this.logger.warn?.(`[LlmWorkflowPlanner] ${reason}`);

    return normalizeWorkflowStepDecision({
      status: 'error',
      audit: {
        reason,
        blocked: false,
        planner: this.label,
        provider: providerName || lastFailureProviderName || fallbackProviderName
      }
    });
  }
}

module.exports = {
  LlmWorkflowPlanner
};
