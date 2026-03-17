/**
 * 审计日志模块
 * 记录请求/响应对和权限拒绝事件
 * 自动创建日志目录
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(process.cwd(), 'logs', 'audit');
const LOG_FILE_NAME = process.env.IROSE_AUDIT_LOG_FILE || 'audit.log.jsonl';
const LOG_FILE_PATH = path.join(LOGS_DIR, LOG_FILE_NAME);
const MAX_AUDIT_LOG_BYTES = toPositiveInt(process.env.IROSE_AUDIT_LOG_MAX_BYTES, 8 * 1024 * 1024);
const TARGET_AUDIT_LOG_BYTES = Math.min(
  MAX_AUDIT_LOG_BYTES,
  toPositiveInt(process.env.IROSE_AUDIT_LOG_TARGET_BYTES, Math.floor(MAX_AUDIT_LOG_BYTES * 0.75))
);
const COMPACT_CHECK_INTERVAL = toPositiveInt(process.env.IROSE_AUDIT_LOG_COMPACT_INTERVAL, 50);
let writeCount = 0;

/**
 * 确保日志目录存在
 */
const ensureLogDir = () => {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
};

/**
 * 获取审计日志文件路径
 * @returns {string} - 日志文件路径
 */
const getTodayLogPath = () => {
  return LOG_FILE_PATH;
};

/**
 * 记录请求/响应对到日志
 * @param {Object} request - 请求对象
 * @param {Object} response - 响应对象
 */
const logRequest = (request, response) => {
  const logEntry = {
    timestamp: Date.now(),
    type: 'request_response',
    request,
    response
  };
  appendAuditLine(logEntry);
};

/**
 * 记录权限拒绝事件
 * @param {string} userId - 用户 ID
 * @param {string} action - 尝试的操作
 * @param {string} reason - 拒绝原因
 */
const logPermissionDenied = (userId, action, reason) => {
  const logEntry = {
    timestamp: Date.now(),
    type: 'permission_denied',
    userId,
    action,
    reason
  };
  appendAuditLine(logEntry);
};

/**
 * 记录一般审计事件
 * @param {string} type - 事件类型
 * @param {Object} data - 事件数据
 */
const logEvent = (type, data) => {
  const logEntry = {
    timestamp: Date.now(),
    type,
    ...data
  };
  appendAuditLine(logEntry);
};

const appendAuditLine = (entry) => {
  ensureLogDir();
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(LOG_FILE_PATH, line, 'utf8');
  compactAuditLogIfNeeded();
};

const compactAuditLogIfNeeded = () => {
  writeCount += 1;
  if (writeCount % COMPACT_CHECK_INTERVAL !== 0) {
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(LOG_FILE_PATH);
  } catch {
    return;
  }
  if (!stat || stat.size <= MAX_AUDIT_LOG_BYTES) {
    return;
  }

  let content = '';
  try {
    content = fs.readFileSync(LOG_FILE_PATH, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return;
  }

  const retained = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (retained.length > 0 && bytes + lineBytes > TARGET_AUDIT_LOG_BYTES) {
      break;
    }
    retained.push(line);
    bytes += lineBytes;
  }
  retained.reverse();

  const nextContent = retained.map(line => `${line}\n`).join('');
  const tempPath = `${LOG_FILE_PATH}.tmp`;
  try {
    fs.writeFileSync(tempPath, nextContent, 'utf8');
    fs.renameSync(tempPath, LOG_FILE_PATH);
  } catch {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore cleanup failure
    }
  }
};

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

module.exports = {
  logRequest,
  logPermissionDenied,
  logEvent,
  ensureLogDir,
  getTodayLogPath,
  LOGS_DIR,
  LOG_FILE_PATH
};
