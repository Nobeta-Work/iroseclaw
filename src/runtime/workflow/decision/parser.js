/**
 * Workflow decision parser
 */

const { safeParse, extractJson } = require('../../../utils/json-utils');
const { normalizeWorkflowStepDecision } = require('../../../contracts/workflow');
const { validateWorkflowDecisionPayload } = require('./validator');

function unwrapDecisionPayload(payload, depth = 0) {
  if (depth > 3 || payload == null) {
    return payload;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = safeParse(trimmed) || extractJson(trimmed);
    if (parsed == null) {
      return payload;
    }
    return unwrapDecisionPayload(parsed, depth + 1);
  }

  if (Array.isArray(payload)) {
    if (payload.length !== 1) {
      return payload;
    }
    return unwrapDecisionPayload(payload[0], depth + 1);
  }

  return payload;
}

function extractDecisionPayload(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }
  const trimmed = text.trim();

  const direct = safeParse(trimmed);
  if (direct) {
    return unwrapDecisionPayload(direct);
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectPayload = safeParse(trimmed.slice(objectStart, objectEnd + 1));
    if (objectPayload) {
      return unwrapDecisionPayload(objectPayload);
    }
  }

  const loosePayload = extractJson(trimmed);
  if (Array.isArray(loosePayload) && !trimmed.startsWith('[')) {
    return null;
  }

  return unwrapDecisionPayload(loosePayload);
}

function parseWorkflowDecisionText(text) {
  const payload = extractDecisionPayload(text);

  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      error: 'workflow decision is not valid JSON',
      payload: null,
      decision: null
    };
  }

  const validation = validateWorkflowDecisionPayload(payload);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.errors.join('; '),
      payload,
      decision: null
    };
  }

  return {
    ok: true,
    error: '',
    payload,
    decision: normalizeWorkflowStepDecision(payload)
  };
}

module.exports = {
  parseWorkflowDecisionText
};
