/**
 * Workflow contract
 * 统一 workflow 状态和 step decision 结构
 */

const { generateRequestId } = require('../../utils/json-utils');
const { normalizeToolCall } = require('../tool');
const { normalizeRenderMode } = require('../output');

const WORKFLOW_STATUSES = ['needs_tools', 'final', 'blocked', 'error'];

function normalizeFinalOutput(output = {}) {
  const operations = Array.isArray(output.operations)
    ? output.operations
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({ ...item }))
    : [];

  return {
    mode: typeof output.mode === 'string' && output.mode.trim()
      ? output.mode.trim()
      : 'reply',
    text: typeof output.text === 'string' ? output.text : '',
    renderMode: normalizeRenderMode(output.renderMode),
    replySegments: Array.isArray(output.replySegments) ? [...output.replySegments] : [],
    operations
  };
}

function normalizeStatePatch(value) {
  const patch = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  const normalizeScope = (scopeValue) => (
    scopeValue && typeof scopeValue === 'object' && !Array.isArray(scopeValue)
      ? { ...scopeValue }
      : {}
  );

  return {
    workflow: normalizeScope(patch.workflow),
    session: normalizeScope(patch.session),
    room: normalizeScope(patch.room),
    user: normalizeScope(patch.user)
  };
}

function createWorkflowEnvelope(input = {}) {
  const step = Number(input.step);

  return {
    workflowId: typeof input.workflowId === 'string' && input.workflowId.trim()
      ? input.workflowId.trim()
      : `wf_${generateRequestId()}`,
    requestId: typeof input.requestId === 'string' && input.requestId.trim()
      ? input.requestId.trim()
      : `req_${generateRequestId()}`,
    version: typeof input.version === 'string' && input.version.trim()
      ? input.version.trim()
      : 'irose.workflow/v1alpha1',
    step: Number.isFinite(step) && step >= 0 ? Math.floor(step) : 0,
    trigger: input.trigger && typeof input.trigger === 'object' ? { ...input.trigger } : {},
    state: input.state && typeof input.state === 'object' ? { ...input.state } : {},
    toolHistory: Array.isArray(input.toolHistory) ? [...input.toolHistory] : [],
    outputHistory: Array.isArray(input.outputHistory) ? [...input.outputHistory] : [],
    decisionHistory: Array.isArray(input.decisionHistory) ? [...input.decisionHistory] : []
  };
}

function normalizeWorkflowStepDecision(decision = {}) {
  const status = WORKFLOW_STATUSES.includes(decision.status)
    ? decision.status
    : 'error';

  const audit = decision.audit && typeof decision.audit === 'object'
    ? {
        reason: typeof decision.audit.reason === 'string' ? decision.audit.reason : '',
        blocked: decision.audit.blocked === true,
        planner: typeof decision.audit.planner === 'string' ? decision.audit.planner : '',
        provider: typeof decision.audit.provider === 'string' ? decision.audit.provider : ''
      }
    : {
        reason: '',
        blocked: false,
        planner: '',
        provider: ''
      };

  return {
    status,
    decisionSummary: typeof decision.decisionSummary === 'string' ? decision.decisionSummary : '',
    toolCalls: Array.isArray(decision.toolCalls)
      ? decision.toolCalls.map(normalizeToolCall).filter(call => call.name)
      : [],
    finalOutput: normalizeFinalOutput(decision.finalOutput),
    statePatch: normalizeStatePatch(decision.statePatch),
    audit
  };
}

module.exports = {
  WORKFLOW_STATUSES,
  createWorkflowEnvelope,
  normalizeStatePatch,
  normalizeWorkflowStepDecision
};
