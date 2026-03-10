/**
 * 审计日志模块
 * 记录请求/响应对和权限拒绝事件
 * 自动创建日志目录
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(process.cwd(), 'logs', 'audit');

/**
 * 确保日志目录存在
 */
const ensureLogDir = () => {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
};

/**
 * 获取今日日志文件路径
 * @returns {string} - 日志文件路径
 */
const getTodayLogPath = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return path.join(LOGS_DIR, `${dateStr}.jsonl`);
};

/**
 * 记录请求/响应对到日志
 * @param {Object} request - 请求对象
 * @param {Object} response - 响应对象
 */
const logRequest = (request, response) => {
  ensureLogDir();
  
  const logPath = getTodayLogPath();
  const logEntry = {
    timestamp: Date.now(),
    type: 'request_response',
    request,
    response
  };
  
  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
};

/**
 * 记录权限拒绝事件
 * @param {string} userId - 用户 ID
 * @param {string} action - 尝试的操作
 * @param {string} reason - 拒绝原因
 */
const logPermissionDenied = (userId, action, reason) => {
  ensureLogDir();
  
  const logPath = getTodayLogPath();
  const logEntry = {
    timestamp: Date.now(),
    type: 'permission_denied',
    userId,
    action,
    reason
  };
  
  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
};

/**
 * 记录一般审计事件
 * @param {string} type - 事件类型
 * @param {Object} data - 事件数据
 */
const logEvent = (type, data) => {
  ensureLogDir();
  
  const logPath = getTodayLogPath();
  const logEntry = {
    timestamp: Date.now(),
    type,
    ...data
  };
  
  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
};

module.exports = {
  logRequest,
  logPermissionDenied,
  logEvent,
  ensureLogDir,
  getTodayLogPath,
  LOGS_DIR
};
