/**
 * Runtime policy content helpers
 */

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

function detectSystemRequest(content) {
  const text = typeof content === 'string' ? content.toLowerCase() : '';
  if (!text) return false;
  return SYSTEM_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

function detectDangerousContent(content) {
  const text = typeof content === 'string' ? content.toLowerCase() : '';
  if (!text) return false;
  return DANGEROUS_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

module.exports = {
  SYSTEM_KEYWORDS,
  DANGEROUS_KEYWORDS,
  detectSystemRequest,
  detectDangerousContent
};
