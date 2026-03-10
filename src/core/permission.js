/**
 * 权限模块
 * 管理管理员列表、权限检查和危险内容检测
 */

const { isSameUid } = require('../utils/uid');
const { loadRuntimeConfig } = require('../config/runtime');

// 系统级请求关键词
const SYSTEM_KEYWORDS = [
  '系统命令',
  'system',
  'admin',
  'sudo',
  '执行命令',
  '运行脚本',
  '重启',
  '关闭',
  '删除',
  '格式化',
  '权限',
  '配置'
];

// 危险内容关键词
const DANGEROUS_KEYWORDS = [
  '密码',
  'token',
  '密钥',
  '私钥',
  'credential',
  'secret',
  '注入',
  'sql',
  'xss',
  '绕过',
  '提权',
  'exploit'
];

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
  const admins = config.admins || [];
  
  return admins.some(adminId => isSameUid(adminId, userId));
};

/**
 * 检查用户权限
 * @param {string} userId - 用户 ID
 * @param {string} action - 操作类型
 * @returns {Object} - { allowed: boolean, reason: string }
 */
const checkPermission = (userId, action) => {
  const config = loadConfig();
  const permissions = config.permissions || {};
  const defaultPerm = permissions.default || {};
  
  // 管理员拥有所有权限
  if (isAdmin(userId)) {
    return { allowed: true, reason: '管理员权限' };
  }
  
  // 检查是否允许该操作
  const allowedActions = defaultPerm.allowedActions || [];
  const blockedActions = defaultPerm.blockedActions || [];
  
  if (blockedActions.includes(action)) {
    return { allowed: false, reason: `操作 "${action}" 被禁止` };
  }
  
  if (allowedActions.length > 0 && !allowedActions.includes(action)) {
    return { allowed: false, reason: `操作 "${action}" 未授权` };
  }
  
  return { allowed: true, reason: '默认允许' };
};

/**
 * 检测消息是否包含系统级请求关键词
 * @param {Object} message - 消息对象 { content }
 * @returns {boolean} - 是否包含系统请求
 */
const detectSystemRequest = (message) => {
  if (!message || typeof message.content !== 'string') return false;
  
  const content = message.content.toLowerCase();
  return SYSTEM_KEYWORDS.some(keyword => 
    content.includes(keyword.toLowerCase())
  );
};

/**
 * 检测消息是否包含危险内容
 * @param {Object} message - 消息对象 { content }
 * @returns {boolean} - 是否包含危险内容
 */
const detectDangerousContent = (message) => {
  if (!message || typeof message.content !== 'string') return false;
  
  const content = message.content.toLowerCase();
  return DANGEROUS_KEYWORDS.some(keyword => 
    content.includes(keyword.toLowerCase())
  );
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
