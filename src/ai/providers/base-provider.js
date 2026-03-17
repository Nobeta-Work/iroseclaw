/**
 * Base model provider
 * 统一 AI provider 最小接口，具体 provider 只负责模型 I/O。
 */

class BaseModelProvider {
  constructor(options = {}) {
    this.options = { ...options };
  }

  async complete() {
    throw new Error('BaseModelProvider.complete() must be implemented by subclasses.');
  }
}

module.exports = {
  BaseModelProvider
};
