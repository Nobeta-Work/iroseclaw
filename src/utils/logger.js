/**
 * 简洁日志模块
 * 支持 DEBUG/INFO/WARN/ERROR 级别，带时间戳和标签
 * 从环境变量 LOG_LEVEL 读取级别
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// 从环境变量读取日志级别，默认 INFO
const getLogLevel = () => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO;
};

const CURRENT_LEVEL = getLogLevel();

// 格式化时间戳
const formatTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

// 内部日志函数
const log = (level, levelName, tag, ...args) => {
  if (level < CURRENT_LEVEL) return;
  
  const timestamp = formatTimestamp();
  const tagStr = tag ? `[${tag}]` : '';
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  
  console.log(`${timestamp} [${levelName}]${tagStr} ${message}`);
};

module.exports = {
  DEBUG: (tag, ...args) => log(LOG_LEVELS.DEBUG, 'DEBUG', tag, ...args),
  INFO: (tag, ...args) => log(LOG_LEVELS.INFO, 'INFO', tag, ...args),
  WARN: (tag, ...args) => log(LOG_LEVELS.WARN, 'WARN', tag, ...args),
  ERROR: (tag, ...args) => log(LOG_LEVELS.ERROR, 'ERROR', tag, ...args),
  debug: (...args) => log(LOG_LEVELS.DEBUG, 'DEBUG', '', ...args),
  info: (...args) => log(LOG_LEVELS.INFO, 'INFO', '', ...args),
  warn: (...args) => log(LOG_LEVELS.WARN, 'WARN', '', ...args),
  error: (...args) => log(LOG_LEVELS.ERROR, 'ERROR', '', ...args),
  
  // 获取当前日志级别
  getLevel: () => CURRENT_LEVEL,
  getLevelName: () => Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === CURRENT_LEVEL) || 'INFO'
};
