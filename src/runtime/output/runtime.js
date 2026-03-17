/**
 * Output Runtime
 * 统一输出执行与 output plugin 调度
 */

const { normalizeOutputOperation } = require('../../contracts/output');

class OutputRuntime {
  constructor(options = {}) {
    this.sender = typeof options.sender === 'function' ? options.sender : null;
    this.policyEngine = options.policyEngine || null;
    this.plugins = [];
  }

  registerPlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new TypeError('output plugin must be an object');
    }

    this.plugins.push(plugin);
    return () => {
      this.plugins = this.plugins.filter(item => item !== plugin);
    };
  }

  async _expandOperations(initialOperations = [], context = {}) {
    let operations = initialOperations.map(item => normalizeOutputOperation(item));

    for (const plugin of this.plugins) {
      if (typeof plugin.expand !== 'function') continue;

      const nextOperations = [];
      for (const operation of operations) {
        const expanded = await plugin.expand(operation, context);
        if (Array.isArray(expanded)) {
          nextOperations.push(...expanded.map(item => normalizeOutputOperation(item)));
        } else if (expanded) {
          nextOperations.push(normalizeOutputOperation(expanded));
        } else {
          nextOperations.push(operation);
        }
      }
      operations = nextOperations;
    }

    return operations;
  }

  async _transformOperation(operation, context = {}) {
    let transformedOperation = normalizeOutputOperation(operation);

    for (const plugin of this.plugins) {
      if (typeof plugin.transform !== 'function') continue;
      const transformed = await plugin.transform(transformedOperation, context);
      if (transformed) {
        transformedOperation = normalizeOutputOperation(transformed);
      }
    }

    return transformedOperation;
  }

  async executeBatch(operationsInput, context = {}) {
    const initialOperations = Array.isArray(operationsInput) ? operationsInput : [operationsInput];
    const expandedOperations = await this._expandOperations(initialOperations, context);
    const results = [];

    for (const operation of expandedOperations) {
      const finalOperation = await this._transformOperation(operation, context);

      if (
        (finalOperation.kind === 'reply.current' || finalOperation.kind === 'message.route') &&
        !String(finalOperation.content?.text || '').trim()
      ) {
        continue;
      }

      if (this.policyEngine && typeof this.policyEngine.evaluateOutputOperation === 'function') {
        const decision = await this.policyEngine.evaluateOutputOperation(context, finalOperation);
        if (!decision.allowed) {
          results.push({
            ok: false,
            blocked: true,
            reason: decision.reason,
            operation: finalOperation
          });
          continue;
        }
      }

      if (!this.sender) {
        results.push({
          ok: false,
          reason: 'no output sender configured',
          operation: finalOperation
        });
        continue;
      }

      const result = await this.sender(finalOperation, context);
      if (
        context &&
        context.workflowBudget &&
        Number.isFinite(Number(context.workflowBudget.messagesSent))
      ) {
        context.workflowBudget.messagesSent += 1;
      }
      results.push({
        ok: true,
        operation: finalOperation,
        result,
        summary: `output sent via ${finalOperation.kind}`
      });
    }

    return results;
  }

  async execute(operationInput, context = {}) {
    const results = await this.executeBatch(operationInput, context);
    return results[0] || {
      ok: false,
      reason: 'no output operation executed'
    };
  }
}

module.exports = {
  OutputRuntime
};
