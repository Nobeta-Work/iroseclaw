/**
 * Direct reply agent
 * 为代码/markdown 等更适合直接生成的请求提供 agent-style 直答能力。
 */

const { buildContextPrompt } = require('./workflow/prompt/serializers');
const { buildPromptProfileLines, resolvePromptProfile } = require('./workflow/prompt/compiler');
const { containsMarkdownCodeFence } = require('../utils/iirose-markdown');

function normalizeText(value, max = 120000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
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
    normalized.includes('internalerror.')
  );
}

function looksLikeMarkdownIntent(text = '') {
  return /(markdown|md格式|markdown格式|代码块|code\s*block|```)/i.test(String(text || ''));
}

function looksLikeCodeIntent(text = '') {
  return /((代码|程序|脚本|算法|函数|类|示例|示例代码|代码示例|snippet|demo|修复.{0,10}代码|实现.{0,10}(算法|功能)|用.{0,10}语言实现).{0,12}(python|py|java|javascript|js|typescript|ts|go|golang|rust|sql|bash|shell|html|css|json|yaml|xml|c\+\+|c#)?)|(\bpython\b|\bjava\b|\bjavascript\b|\bjs\b|\btypescript\b|\bts\b|\bgo\b|\bgolang\b|\brust\b|\bsql\b|\bbash\b|\bshell\b|\bhtml\b|\bcss\b|\bjson\b|\byaml\b|\bxml\b|c\+\+|c#)/i.test(String(text || ''));
}

function inferLanguage(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (/\bpython\b|\bpy\b/.test(normalized)) return 'python';
  if (/\bjavascript\b|\bjs\b/.test(normalized)) return 'javascript';
  if (/\btypescript\b|\bts\b/.test(normalized)) return 'typescript';
  if (/\bjava\b/.test(normalized)) return 'java';
  if (/\bgolang\b|\bgo\b/.test(normalized)) return 'go';
  if (/\brust\b/.test(normalized)) return 'rust';
  if (/\bsql\b/.test(normalized)) return 'sql';
  if (/\bbash\b|\bshell\b/.test(normalized)) return 'bash';
  if (/\bhtml\b/.test(normalized)) return 'html';
  if (/\bcss\b/.test(normalized)) return 'css';
  if (/\bjson\b/.test(normalized)) return 'json';
  if (/\byaml\b/.test(normalized)) return 'yaml';
  if (/\bxml\b/.test(normalized)) return 'xml';
  if (/c\+\+/.test(normalized)) return 'cpp';
  if (/c#/.test(normalized)) return 'csharp';
  if (/\bc语言\b|\bc\b/.test(normalized)) return 'c';
  return '';
}

function looksLikeCodeBody(text = '') {
  const value = normalizeText(text, 20000);
  if (!value) return false;
  return /[{};]/.test(value)
    || /\b(function|def|class|public|private|package|import|return|console\.log|printf|println|SELECT|INSERT|UPDATE|DELETE|include)\b/i.test(value);
}

function normalizeDirectReplyText(replyText = '', requestText = '') {
  const text = normalizeText(replyText);
  if (!text) {
    return {
      text: '',
      renderMode: 'plain'
    };
  }

  if (containsMarkdownCodeFence(text)) {
    return {
      text,
      renderMode: 'markdown'
    };
  }

  if (looksLikeCodeIntent(requestText) && looksLikeCodeBody(text) && text.includes('\n')) {
    const language = inferLanguage(requestText);
    return {
      text: `\`\`\`${language}\n${text}\n\`\`\``,
      renderMode: 'markdown'
    };
  }

  if (looksLikeMarkdownIntent(requestText) || (looksLikeCodeIntent(requestText) && text.includes('\n'))) {
    return {
      text,
      renderMode: 'markdown'
    };
  }

  return {
    text,
    renderMode: 'plain'
  };
}

function createDirectReplyAgent(options = {}) {
  const provider = options.provider || null;
  const logger = options.logger || console;
  const config = options.config && typeof options.config === 'object' ? options.config : {};
  const maxProviderRetries = Number.isFinite(Number(config.maxProviderRetries))
    ? Math.max(0, Math.floor(Number(config.maxProviderRetries)))
    : 2;

  function buildPrompt(input = {}) {
    const protocolRequest = input.protocolRequest || {};
    const requestText = getCurrentRequestText(input);
    const contextPrompt = buildContextPrompt(protocolRequest, {
      useNativeSessionContext: config.useNativeSessionContext === true
    });
    const promptProfile = resolvePromptProfile(input, {
      promptProfile: config.promptProfile || {},
      promptProfileService: config.promptProfileService || null
    });
    const lines = [
      contextPrompt,
      ''
    ];

    lines.push(...buildPromptProfileLines(promptProfile), '');
    lines.push(
      '现在进入 direct reply 模式。',
      '不要输出 JSON，不要描述工具调用，不要提及系统、planner、workflow 或内部状态。',
      '直接输出将要发送给用户的最终回复内容。'
    );

    if (looksLikeCodeIntent(requestText) || looksLikeMarkdownIntent(requestText)) {
      lines.push('当前请求与代码或 markdown 有关。');
      lines.push('如果要给代码，必须直接给出最小可运行示例，并优先使用 markdown 代码块。');
      lines.push('如果用户贴了现有代码，优先直接修复代码，不要只复读需求。');
      lines.push('除简短必要说明外，不要输出无关铺垫。');
    } else {
      lines.push('保持自然、直接、贴近上下文。');
    }

    return lines.join('\n');
  }

  return {
    shouldHandleRequest(text = '') {
      return looksLikeCodeIntent(text) || looksLikeMarkdownIntent(text);
    },
    async generateReply(input = {}) {
      if (!provider || typeof provider.complete !== 'function') {
        return {
          ok: false,
          error: 'direct reply provider is not configured',
          text: '',
          renderMode: 'plain',
          provider: ''
        };
      }

      let result = null;
      let rawText = '';
      for (let attempt = 0; attempt <= maxProviderRetries; attempt += 1) {
        result = await provider.complete({
          message: buildPrompt(input),
          timeoutMs: config.timeoutMs,
          json: false
        });
        rawText = normalizeText(result?.text || result?.jsonText || result?.plainText || '');
        const retryableFailure = result?.ok === false || looksLikeProviderErrorText(rawText);
        if (!retryableFailure || attempt >= maxProviderRetries) {
          break;
        }

        logger.warn?.(
          `[DirectReplyAgent] retrying provider after attempt ${attempt + 1}: ${result?.error || rawText.slice(0, 160)}`
        );
      }

      const providerName = result?.provider || provider?.label || provider?.provider || provider?.constructor?.name || '';

      if (result?.ok === false) {
        return {
          ok: false,
          error: result.error || 'unknown provider error',
          text: '',
          renderMode: 'plain',
          provider: providerName
        };
      }

      if (!rawText || looksLikeProviderErrorText(rawText)) {
        logger.warn?.(`[DirectReplyAgent] invalid direct reply output: ${rawText.slice(0, 160)}`);
        return {
          ok: false,
          error: rawText ? `provider error text: ${rawText.slice(0, 600)}` : 'empty direct reply output',
          text: '',
          renderMode: 'plain',
          provider: providerName
        };
      }

      const normalized = normalizeDirectReplyText(rawText, getCurrentRequestText(input));
      return {
        ok: true,
        error: '',
        text: normalized.text,
        renderMode: normalized.renderMode,
        provider: providerName
      };
    }
  };
}

module.exports = {
  createDirectReplyAgent
};
