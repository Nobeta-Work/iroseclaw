/**
 * 权限模块
 * 管理管理员列表、权限检查和危险内容检测
 */

const { isSameUid } = require('../utils/uid');
const { loadRuntimeConfig } = require('../config/runtime');
const {
  detectSystemRequest: detectSystemRequestContent,
  detectDangerousContent: detectDangerousContentContent
} = require('../runtime/policy/content');
const { isAdminUser, checkConfiguredActionPermission } = require('../runtime/policy/access');

/**
 * 加载配置文件（统一入口）
 * @returns {Object} - 配置对象
 */
const loadConfig = () => {
  return loadRuntimeConfig();
};

/**
 * 检查用户是否为管理员（大小写无关）
 * @param {string} userId - 用户 ID
 * @returns {boolean} - 是否为管理员
 */
const isAdmin = (userId) => {
  const config = loadConfig();
  return isAdminUser(config, userId);
};

/**
 * 检查用户权限
 * @param {string} userId - 用户 ID
 * @param {string} action - 操作类型
 * @returns {Object} - { allowed: boolean, reason: string }
 */
const checkPermission = (userId, action) => {
  const config = loadConfig();
  return checkConfiguredActionPermission(config, userId, action);
};

/**
 * 检测消息是否包含系统级请求关键词
 * @param {Object} message - 消息对象 { content }
 * @returns {boolean} - 是否包含系统请求
 */
const detectSystemRequest = (message) => {
  if (!message || typeof message.content !== 'string') return false;
  return detectSystemRequestContent(message.content);
};

/**
 * 检测消息是否包含危险内容
 * @param {Object} message - 消息对象 { content }
 * @returns {boolean} - 是否包含危险内容
 */
const detectDangerousContent = (message) => {
  if (!message || typeof message.content !== 'string') return false;
  return detectDangerousContentContent(message.content);
};

/**
 * 强制刷新配置（用于外部触发重新加载）
 */
const refreshConfig = () => {
  loadRuntimeConfig({ forceReload: true });
};

module.exports = {
  isAdmin,
  checkPermission,
  detectSystemRequest,
  detectDangerousContent,
  refreshConfig,
  loadConfig
};
