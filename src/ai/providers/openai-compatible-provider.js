/**
 * OpenAI-compatible provider
 * 通过标准 chat completions HTTP 接口调用普通无状态模型 API。
 */

const { BaseModelProvider } = require('./base-provider');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, maxChars = 2000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxChars);
}

function normalizeHeaders(headers = {}) {
  if (!isPlainObject(headers)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = normalizeText(key, 120);
    if (!name) continue;
    const headerValue = normalizeText(value, 4000);
    if (!headerValue) continue;
    normalized[name] = headerValue;
  }
  return normalized;
}

function normalizeMessage(message = {}) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const role = normalizeText(message.role, 32) || 'user';
  if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(role)) {
    return null;
  }

  if (typeof message.content === 'string') {
    const content = normalizeText(message.content, 120000);
    return content ? { role, content } : null;
  }

  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          return item.text.trim();
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) {
      return {
        role,
        content: parts.join('\n')
      };
    }
  }

  return null;
}

function buildMessages(input = {}) {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    const normalized = input.messages
      .map(item => normalizeMessage(item))
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const messages = [];
  const systemPrompt = normalizeText(input.systemPrompt, 120000);
  const userPrompt = normalizeText(input.userPrompt, 120000);
  const message = normalizeText(input.message, 120000);

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  } else if (message) {
    messages.push({ role: 'user', content: message });
  }

  return messages;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts = content
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') {
          return item.text.trim();
        }
        if (item.type === 'output_text' && typeof item.text === 'string') {
          return item.text.trim();
        }
      }
      return '';
    })
    .filter(Boolean);

  return parts.join('\n').trim();
}

function extractTextFromResponse(payload = {}) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const messageText = extractTextFromContent(choice?.message?.content);
  if (messageText) {
    return messageText;
  }

  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputItems) {
    const text = extractTextFromContent(item?.content);
    if (text) {
      return text;
    }
  }

  return '';
}

function stringifyErrorPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  try {
    return JSON.stringify(payload).slice(0, 1000);
  } catch {
    return '';
  }
}

class OpenAICompatibleProvider extends BaseModelProvider {
  constructor(options = {}) {
    super(options);
    this.config = {
      baseUrl: normalizeText(options.baseUrl, 4000).replace(/\/+$/, ''),
      apiKey: normalizeText(options.apiKey, 4000),
      model: normalizeText(options.model, 200),
      endpointPath: normalizeText(options.endpointPath, 200) || '/chat/completions',
      timeout: Number.isFinite(Number(options.timeout))
        ? Math.max(1000, Math.floor(Number(options.timeout)))
        : 30000,
      headers: normalizeHeaders(options.headers),
      maxTokens: Number.isFinite(Number(options.maxTokens))
        ? Math.max(1, Math.floor(Number(options.maxTokens)))
        : 0
    };
    this.label = options.label || options.provider || 'openai-compatible';
    this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
    this.supportsStatefulSessions = false;
  }

  _buildUrl() {
    if (!this.config.baseUrl) {
      return '';
    }

    const endpoint = this.config.endpointPath.startsWith('/')
      ? this.config.endpointPath
      : `/${this.config.endpointPath}`;
    return `${this.config.baseUrl}${endpoint}`;
  }

  _buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      ...this.config.headers
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  _buildBody(input = {}) {
    const body = {
      model: normalizeText(input.model, 200) || this.config.model,
      messages: buildMessages(input)
    };

    if (input.json === true) {
      body.response_format = { type: 'json_object' };
    }

    const maxTokens = Number.isFinite(Number(input.maxTokens))
      ? Math.max(1, Math.floor(Number(input.maxTokens)))
      : this.config.maxTokens;
    if (maxTokens > 0) {
      body.max_tokens = maxTokens;
    }

    return body;
  }

  async complete(input = {}) {
    if (typeof this.fetchImpl !== 'function') {
      return {
        ok: false,
        provider: this.label,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: null,
        error: 'fetch is not available'
      };
    }

    const url = this._buildUrl();
    if (!url) {
      return {
        ok: false,
        provider: this.label,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: null,
        error: 'baseUrl is required'
      };
    }

    const body = this._buildBody(input);
    if (!body.model) {
      return {
        ok: false,
        provider: this.label,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: null,
        error: 'model is required'
      };
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return {
        ok: false,
        provider: this.label,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: null,
        error: 'message is required'
      };
    }

    const timeoutMs = Number.isFinite(Number(input.timeoutMs))
      ? Math.max(1000, Math.floor(Number(input.timeoutMs)))
      : this.config.timeout;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          provider: this.label,
          text: '',
          jsonText: '',
          plainText: '',
          json: payload,
          raw: {
            url,
            request: body,
            status: response.status,
            statusText: response.statusText,
            text
          },
          error: `HTTP ${response.status}: ${stringifyErrorPayload(payload) || response.statusText || text || 'request failed'}`
        };
      }

      const replyText = extractTextFromResponse(payload || {});
      return {
        ok: true,
        provider: this.label,
        text: replyText,
        jsonText: input.json === true ? replyText : '',
        plainText: input.json === true ? '' : replyText,
        json: payload,
        raw: {
          url,
          request: body,
          status: response.status,
          statusText: response.statusText,
          text
        },
        error: ''
      };
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      return {
        ok: false,
        provider: this.label,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: {
          url,
          request: body
        },
        error: aborted ? `request timeout after ${timeoutMs}ms` : (error.message || 'request failed')
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  OpenAICompatibleProvider,
  buildMessages,
  extractTextFromResponse
};
