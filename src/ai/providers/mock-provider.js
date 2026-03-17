/**
 * Mock provider
 * 用于测试和本地无 OpenClaw 场景。
 */

const { BaseModelProvider } = require('./base-provider');

class MockProvider extends BaseModelProvider {
  constructor(options = {}) {
    super(options);
    this.responses = Array.isArray(options.responses) ? [...options.responses] : [];
    this.handler = typeof options.handler === 'function' ? options.handler : null;
    this.calls = [];
    this.label = options.label || 'mock';
    this.supportsStatefulSessions = options.supportsStatefulSessions === true;
  }

  async complete(input = {}) {
    this.calls.push(input);

    const next = this.handler
      ? await this.handler(input, this.calls.length - 1)
      : (this.responses.length > 0 ? this.responses.shift() : { ok: true, text: '' });

    if (typeof next === 'string') {
      return {
        ok: true,
        provider: this.label,
        text: next,
        jsonText: '',
        plainText: next,
        json: null,
        raw: next,
        error: ''
      };
    }

    const payload = next && typeof next === 'object' ? next : {};
    return {
      ok: payload.ok !== false,
      provider: payload.provider || this.label,
      text: typeof payload.text === 'string' ? payload.text : '',
      jsonText: typeof payload.jsonText === 'string' ? payload.jsonText : '',
      plainText: typeof payload.plainText === 'string' ? payload.plainText : '',
      json: payload.json ?? null,
      raw: payload.raw ?? payload,
      error: typeof payload.error === 'string' ? payload.error : ''
    };
  }
}

module.exports = {
  MockProvider
};
