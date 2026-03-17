/**
 * Runtime policy access helpers
 */

const { isSameUid } = require('../../utils/uid');

function isAdminUser(config = {}, userId = '') {
  const admins = Array.isArray(config.admins) ? config.admins : [];
  return admins.some(adminId => isSameUid(adminId, userId));
}

function checkConfiguredActionPermission(config = {}, userId = '', action = '') {
  const permissions = config.permissions || {};
  const defaultPerm = permissions.default || {};
  const adminPerm = permissions.admin || {};

  if (isAdminUser(config, userId)) {
    const blockedActions = Array.isArray(adminPerm.blockedActions) ? adminPerm.blockedActions : [];
    if (blockedActions.includes(action)) {
      return { allowed: false, reason: `操作 "${action}" 被管理员权限配置禁止` };
    }
    return { allowed: true, reason: '管理员权限' };
  }

  const allowedActions = Array.isArray(defaultPerm.allowedActions) ? defaultPerm.allowedActions : [];
  const blockedActions = Array.isArray(defaultPerm.blockedActions) ? defaultPerm.blockedActions : [];

  if (blockedActions.includes(action)) {
    return { allowed: false, reason: `操作 "${action}" 被禁止` };
  }

  if (allowedActions.length > 0 && !allowedActions.includes(action)) {
    return { allowed: false, reason: `操作 "${action}" 未授权` };
  }

  return { allowed: true, reason: '默认允许' };
}

module.exports = {
  isAdminUser,
  checkConfiguredActionPermission
};
