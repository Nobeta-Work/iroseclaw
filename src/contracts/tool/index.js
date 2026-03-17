/**
 * Tool contract
 * 统一工具定义、调用和结果结构
 */

const TOOL_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function normalizeStatePatch(value) {
  const patch = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return {
    workflow: normalizeObject(patch.workflow),
    session: normalizeObject(patch.session),
    room: normalizeObject(patch.room),
    user: normalizeObject(patch.user)
  };
}

function normalizeToolDefinition(definition = {}) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('tool definition must be an object');
  }

  const name = String(definition.name || '').trim();
  if (!name) {
    throw new Error('tool definition requires a name');
  }

  if (typeof definition.execute !== 'function') {
    throw new Error(`tool "${name}" requires an execute() function`);
  }

  const riskLevel = TOOL_RISK_LEVELS.includes(definition.riskLevel)
    ? definition.riskLevel
    : 'medium';

  return {
    name,
    description: String(definition.description || '').trim(),
    inputSchema: normalizeObject(definition.inputSchema),
    outputSchema: normalizeObject(definition.outputSchema),
    aliases: normalizeStringArray(definition.aliases),
    permission: Array.isArray(definition.permission)
      ? normalizeStringArray(definition.permission)
      : (typeof definition.permission === 'string' && definition.permission.trim()
        ? [definition.permission.trim()]
        : []),
    scopes: normalizeStringArray(definition.scopes),
    readOnly: definition.readOnly === true,
    sideEffect: definition.sideEffect === true,
    riskLevel,
    timeoutMs: Number.isFinite(Number(definition.timeoutMs))
      ? Math.max(1, Math.floor(Number(definition.timeoutMs)))
      : 10000,
    metadata: normalizeObject(definition.metadata),
    origin: typeof definition.origin === 'string' && definition.origin.trim()
      ? definition.origin.trim()
      : 'custom',
    execute: definition.execute
  };
}

function normalizeToolCall(call = {}) {
  return {
    callId: typeof call.callId === 'string' && call.callId.trim()
      ? call.callId.trim()
      : '',
    name: typeof call.name === 'string' ? call.name.trim() : '',
    arguments: normalizeObject(call.arguments),
    idempotencyKey: typeof call.idempotencyKey === 'string' ? call.idempotencyKey.trim() : ''
  };
}

function createToolResult(input = {}) {
  return {
    ok: input.ok !== false,
    name: typeof input.name === 'string' ? input.name.trim() : '',
    callId: typeof input.callId === 'string' ? input.callId.trim() : '',
    result: input.result === undefined ? null : input.result,
    data: input.data === undefined ? null : input.data,
    outputs: Array.isArray(input.outputs) ? [...input.outputs] : [],
    statePatch: normalizeStatePatch(input.statePatch),
    summary: typeof input.summary === 'string' ? input.summary : '',
    error: typeof input.error === 'string' ? input.error : ''
  };
}

module.exports = {
  TOOL_RISK_LEVELS,
  normalizeToolDefinition,
  normalizeToolCall,
  createToolResult,
  normalizeStatePatch
};
