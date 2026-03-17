/**
 * Workflow hook registry
 */

class WorkflowHookRegistry {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.hooks = [];
  }

  register(hook) {
    if (!hook || typeof hook !== 'object') {
      throw new TypeError('workflow hook must be an object');
    }

    this.hooks.push(hook);
    return () => {
      this.hooks = this.hooks.filter(item => item !== hook);
    };
  }

  list() {
    return [...this.hooks];
  }

  async run(methodName, payload = {}) {
    const results = [];

    for (const hook of this.hooks) {
      const fn = hook?.[methodName];
      if (typeof fn !== 'function') continue;

      try {
        results.push(await fn(payload));
      } catch (error) {
        this.logger.warn?.(`[WorkflowHookRegistry] ${methodName} failed: ${error.message}`);
      }
    }

    return results;
  }
}

module.exports = {
  WorkflowHookRegistry
};
