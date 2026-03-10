/**
 * UID 工具模块
 * 用于 IIROSE UID 的标准化、比较和验证
 */

/**
 * 统一 UID 转小写
 * @param {string} uid - 原始 UID
 * @returns {string} - 标准化后的小写 UID
 */
const normalizeUid = (uid) => {
  if (typeof uid !== 'string') return '';
  return uid.toLowerCase().trim();
};

/**
 * 大小写无关比较两个 UID 是否相同
 * @param {string} a - UID A
 * @param {string} b - UID B
 * @returns {boolean} - 是否相同
 */
const isSameUid = (a, b) => {
  if (!a || !b) return false;
  return normalizeUid(a) === normalizeUid(b);
};

/**
 * 检查是否为有效 IIROSE UID 格式（十六进制字符串）
 * IIROSE UID 通常为 32 位或 36 位十六进制字符串（可能带连字符）
 * @param {string} uid - 待检查的 UID
 * @returns {boolean} - 是否有效
 */
const isValidUid = (uid) => {
  if (typeof uid !== 'string' || !uid) return false;
  
  // 移除连字符后检查是否为十六进制
  const cleanUid = uid.replace(/-/g, '');
  
  // IIROSE UID 通常是 32 位十六进制（UUID 无连字符格式）
  // 也允许其他长度的十六进制字符串
  if (cleanUid.length < 8) return false;
  
  // 检查是否全为十六进制字符
  return /^[0-9a-fA-F]+$/.test(cleanUid);
};

module.exports = {
  normalizeUid,
  isSameUid,
  isValidUid
};
