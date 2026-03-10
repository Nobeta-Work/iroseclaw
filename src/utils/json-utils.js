/**
 * JSON 工具模块
 * 提供安全的 JSON 解析、提取和 ID 生成功能
 */

/**
 * 安全解析 JSON 字符串，失败返回 null
 * @param {string} str - JSON 字符串
 * @returns {any|null} - 解析结果或 null
 */
const safeParse = (str) => {
  if (typeof str !== 'string' || !str.trim()) return null;
  
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
};

/**
 * 从混合文本中提取第一个 JSON 对象
 * 支持提取 {} 或 [] 格式的 JSON
 * @param {string} text - 混合文本
 * @returns {any|null} - 提取的 JSON 对象或 null
 */
const extractJson = (text) => {
  if (typeof text !== 'string' || !text) return null;
  
  // 查找第一个 { 或 [
  const startIdx = Math.min(
    text.indexOf('{') !== -1 ? text.indexOf('{') : Infinity,
    text.indexOf('[') !== -1 ? text.indexOf('[') : Infinity
  );
  
  if (startIdx === Infinity) return null;
  
  const startChar = text[startIdx];
  const endChar = startChar === '{' ? '}' : ']';
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          const jsonStr = text.slice(startIdx, i + 1);
          return safeParse(jsonStr);
        }
      }
    }
  }
  
  return null;
};

/**
 * 生成简单唯一 ID（时间戳 + 随机数）
 * @returns {string} - 唯一 ID
 */
const generateRequestId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}`;
};

module.exports = {
  safeParse,
  extractJson,
  generateRequestId
};
