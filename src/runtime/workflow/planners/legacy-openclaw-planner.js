/**
 * Legacy OpenClaw planner
 * 兼容当前 OpenClaw adapter 的 workflow / legacy chat 响应语义。
 */

const protocol = require('../../../core/protocol');
const { normalizeWorkflowStepDecision } = require('../../../contracts/workflow');
const { BaseWorkflowPlanner } = require('./base-planner');

class LegacyOpenClawPlanner extends BaseWorkflowPlanner {
  constructor(options = {}) {
    super(options);
    this.adapter = options.adapter || null;
    this.label = options.label || 'legacy-openclaw';
  }

  async decideNextStep(input = {}) {
    if (this.adapter && typeof this.adapter.processWorkflowStep === 'function') {
      const decision = await this.adapter.processWorkflowStep(input);
      return normalizeWorkflowStepDecision(decision);
    }

    if (!this.adapter || typeof this.adapter.processMessage !== 'function') {
      return normalizeWorkflowStepDecision({
        status: 'error',
        audit: {
          reason: 'workflow adapter is not available',
          blocked: false
        }
      });
    }

    const rawResponse = await this.adapter.processMessage(input.protocolRequest || {});
    const parsed = protocol.parseResponse(rawResponse);

    if (parsed.isSkillCall && parsed.skillName) {
      return normalizeWorkflowStepDecision({
        status: 'needs_tools',
        toolCalls: [
          {
            callId: `tool_${parsed.skillName}`,
            name: parsed.skillName,
            arguments: parsed.skillArgs && typeof parsed.skillArgs === 'object'
              ? parsed.skillArgs
              : {}
          }
        ],
        audit: parsed.audit
      });
    }

    return normalizeWorkflowStepDecision({
      status: 'final',
      finalOutput: {
        mode: 'reply',
        text: parsed.replyText || '',
        replySegments: parsed.replySegments || []
      },
      audit: parsed.audit
    });
  }
}

module.exports = {
  LegacyOpenClawPlanner
};
