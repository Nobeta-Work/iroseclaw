/**
 * Meme Skill
 * 情绪 -> 第三方图库检索 -> 返回图片 URL（以 image segment 发送）
 */

const { parseMemePayload } = require('../../utils/meme-format');
const { getTimeoutMs, searchMemeByEmotion } = require('../../services/meme/search');

function createMemeSkill() {
  return {
    name: 'meme',
    keywords: [],
    description: '根据情绪检索表情包图片（内部链路使用）',
    handler: async ({ args }) => {
      const parsed = parseMemePayload(args?.format || args?.query || args?.raw || '');
      const emotion = (args?.emotion || parsed.emotion || '').trim();
      const text = typeof args?.text === 'string' ? args.text : parsed.text;

      if (!emotion) {
        return text || null;
      }

      const timeoutMs = getTimeoutMs();
      const imageUrl = await searchMemeByEmotion(emotion, timeoutMs);

      if (!imageUrl) {
        return text || null;
      }

      const imageSegment = `[${imageUrl}#e]`;
      if (text && text.trim()) {
        return `${text.trim()}\n${imageSegment}`;
      }

      return imageSegment;
    }
  };
}

module.exports = {
  createMemeSkill,
  searchMemeByEmotion
};
