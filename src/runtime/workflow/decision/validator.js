/**
 * Workflow decision validator
 */

const { WORKFLOW_STATUSES } = require('../../../contracts/workflow');

function validateWorkflowDecisionPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      errors: ['workflow decision payload must be an object']
    };
  }

  if (!WORKFLOW_STATUSES.includes(payload.status)) {
    errors.push(`invalid workflow decision status: ${String(payload.status || '')}`);
  }

  if (payload.status === 'needs_tools') {
    if (!Array.isArray(payload.toolCalls) || payload.toolCalls.length === 0) {
      errors.push('needs_tools decision must include at least one tool call');
    }
  }

  if (payload.status === 'blocked') {
    const blocked = payload.audit && typeof payload.audit === 'object' && payload.audit.blocked === true;
    if (!blocked) {
      errors.push('blocked decision must set audit.blocked=true');
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

module.exports = {
  validateWorkflowDecisionPayload
};
