/**
 * Runtime config policy rule
 * 将配置中的权限控制前置到 PolicyEngine
 */

const { isSameUid } = require('../../../utils/uid');

function createRuntimeConfigPolicyRule(config = {}) {
  const adminUids = Array.isArray(config.admins) ? [...config.admins] : [];
  const permissions = config.permissions || {};
  const defaultPerm = permissions.default || {};
  const adminPerm = permissions.admin || {};

  function isAdmin(userId) {
    return adminUids.some(adminId => isSameUid(adminId, userId));
  }

  function evaluateActions(userId, actions = []) {
    const normalizedActions = Array.from(new Set(
      actions.map(item => String(item || '').trim()).filter(Boolean)
    ));

    if (normalizedActions.length === 0) {
      return { allowed: true, reason: '' };
    }

    const effectivePerm = isAdmin(userId) ? adminPerm : defaultPerm;
    const allowedActions = Array.isArray(effectivePerm.allowedActions) ? effectivePerm.allowedActions : [];
    const blockedActions = Array.isArray(effectivePerm.blockedActions) ? effectivePerm.blockedActions : [];

    for (const action of normalizedActions) {
      if (blockedActions.includes(action)) {
        return {
          allowed: false,
          reason: `action "${action}" is blocked by runtime policy`
        };
      }
    }

    if (allowedActions.length > 0 && !normalizedActions.some(action => allowedActions.includes(action))) {
      return {
        allowed: false,
        reason: `actions [${normalizedActions.join(', ')}] are not allowed by runtime policy`
      };
    }

    return { allowed: true, reason: '' };
  }

  return async function runtimeConfigPolicyRule(input = {}) {
    const type = input.type;
    const context = input.context || {};
    const userId = String(context.userId || '').trim();

    if (type === 'tool') {
      const toolDefinition = input.toolDefinition || {};
      const actions = Array.isArray(toolDefinition.permission) && toolDefinition.permission.length > 0
        ? toolDefinition.permission
        : [toolDefinition.name || input.toolCall?.name || ''];
      const decision = evaluateActions(userId, actions);
      if (!decision.allowed) {
        return {
          allowed: false,
          action: 'deny',
          reason: decision.reason
        };
      }
    }

    if (type === 'output') {
      const operation = input.operation || {};
      const actions = operation.kind === 'message.route'
        ? ['message.route']
        : ['chat'];
      const decision = evaluateActions(userId, actions);
      if (!decision.allowed) {
        return {
          allowed: false,
          action: 'deny',
          reason: decision.reason
        };
      }
    }

    return null;
  };
}

module.exports = {
  createRuntimeConfigPolicyRule
};
