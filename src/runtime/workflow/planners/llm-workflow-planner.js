/**
 * LLM workflow planner
 * 使用 provider + framework prompt/decision 协议产出下一步 workflow 决策。
 */

const { normalizeWorkflowStepDecision } = require('../../../contracts/workflow');
const { BaseWorkflowPlanner } = require('./base-planner');
const { compileWorkflowPrompt } = require('../prompt/compiler');
const { parseWorkflowDecisionText } = require('../decision/parser');

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

    return normalizeProviderName(providerName) === 'openclaw' ? 1 : 0;
  }

  _shouldRetry(result, parsed, providerName, attempt, maxRetries) {
    if (attempt >= maxRetries) {
      return false;
    }

    const normalizedProvider = normalizeProviderName(providerName);
    if (normalizedProvider !== 'openclaw') {
      return false;
    }

    if (result?.ok === false) {
      return true;
    }

    if (parsed?.ok === true) {
      return false;
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
      const parsed = parseWorkflowDecisionText(decisionText);

      if (parsed.ok && parsed.decision) {
        return normalizeWorkflowStepDecision({
          ...parsed.decision,
          audit: {
            ...(parsed.decision.audit || {}),
            planner: this.label,
            provider: providerName
          }
        });
      }

      lastResult = result;
      lastParsed = parsed;

      if (this._shouldRetry(result, parsed, providerName, attempt, maxRetries)) {
        const retryReason = result?.ok === false
          ? `provider error: ${result.error || 'unknown error'}`
          : `invalid workflow decision: ${parsed.error || 'empty response'}`;
        this.logger.warn?.(
          `[LlmWorkflowPlanner] retrying OpenClaw provider after attempt ${attempt + 1}: ${retryReason}`
        );
        continue;
      }

      break;
    }

    const reason = lastResult?.ok === false
      ? `provider error: ${lastResult.error || 'unknown error'}`
      : `invalid workflow decision: ${lastParsed?.error || 'empty response'}`;
    this.logger.warn?.(`[LlmWorkflowPlanner] ${reason}`);

    return normalizeWorkflowStepDecision({
      status: 'error',
      audit: {
        reason,
        blocked: false,
        planner: this.label,
        provider: providerName || fallbackProviderName
      }
    });
  }
}

module.exports = {
  LlmWorkflowPlanner
};
