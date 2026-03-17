/**
 * Policy Engine
 * 统一裁决 tool call 与 output operation
 */

class PolicyEngine {
  constructor(config = {}) {
    this.config = {
      allowHighRiskTools: config.allowHighRiskTools === true,
      allowCrossSessionSend: config.allowCrossSessionSend === true,
      maxMessagesPerWorkflow: Number.isFinite(Number(config.maxMessagesPerWorkflow))
        ? Math.max(1, Math.floor(Number(config.maxMessagesPerWorkflow)))
        : 3
    };
    this.rules = [];
  }

  registerRule(rule) {
    if (typeof rule !== 'function') {
      throw new TypeError('policy rule must be a function');
    }

    this.rules.push(rule);
    return () => {
      this.rules = this.rules.filter(item => item !== rule);
    };
  }

  async evaluateToolCall(context = {}, toolCall = {}, toolDefinition = null) {
    const riskLevel = toolDefinition?.riskLevel || 'medium';

    if (!toolDefinition) {
      return {
        allowed: false,
        action: 'deny',
        reason: 'tool not registered'
      };
    }

    if ((riskLevel === 'high' || riskLevel === 'critical') && !this.config.allowHighRiskTools) {
      return {
        allowed: false,
        action: 'deny',
        reason: 'high-risk tools are disabled by policy'
      };
    }

    for (const rule of this.rules) {
      const decision = await rule({
        type: 'tool',
        context,
        toolCall,
        toolDefinition
      });

      if (decision && decision.allowed === false) {
        return {
          allowed: false,
          action: decision.action || 'deny',
          reason: decision.reason || 'blocked by policy rule'
        };
      }
    }

    return {
      allowed: true,
      action: 'allow',
      reason: ''
    };
  }

  async evaluateOutputOperation(context = {}, operation = {}) {
    const targetScope = operation?.target?.scope || 'current-session';
    const workflowBudget = context?.workflowBudget;

    if (targetScope !== 'current-session' && !this.config.allowCrossSessionSend) {
      return {
        allowed: false,
        action: 'deny',
        reason: 'cross-session output is disabled by policy'
      };
    }

    if (
      workflowBudget &&
      Number.isFinite(Number(workflowBudget.maxMessages)) &&
      Number(workflowBudget.messagesSent || 0) >= Number(workflowBudget.maxMessages)
    ) {
      return {
        allowed: false,
        action: 'deny',
        reason: 'workflow output budget exceeded'
      };
    }

    for (const rule of this.rules) {
      const decision = await rule({
        type: 'output',
        context,
        operation
      });

      if (decision && decision.allowed === false) {
        return {
          allowed: false,
          action: decision.action || 'deny',
          reason: decision.reason || 'blocked by policy rule'
        };
      }
    }

    return {
      allowed: true,
      action: 'allow',
      reason: ''
    };
  }
}

module.exports = {
  PolicyEngine
};
