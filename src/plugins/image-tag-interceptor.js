/**
 * Image Tag Interceptor
 * 拦截发送链路中的 $image=情绪$ 标记并替换为图片段
 */

const { searchMemeByEmotion } = require('../services/meme/search');
const logger = require('../utils/logger');

const IMAGE_TAG_REGEX = /\$image\s*[=＝]\s*([^\r\n$]{1,24})\$/gi;
const IMAGE_TAG_TRIGGER_REGEX = /\$image\s*[=＝]\s*[^\r\n$]{1,24}\$/i;
const SUPPORTED_EMOTIONS = new Set(['开心', '难过', '生气', '惊讶', '无语', '疑惑', '调皮', '安慰']);

const EMOTION_ALIASES = new Map([
  ['happy', '开心'],
  ['高兴', '开心'],
  ['sad', '难过'],
  ['伤心', '难过'],
  ['angry', '生气'],
  ['愤怒', '生气'],
  ['surprised', '惊讶'],
  ['震惊', '惊讶'],
  ['confused', '疑惑'],
  ['迷惑', '疑惑'],
  ['comfort', '安慰'],
  ['安抚', '安慰']
]);

function getTimeoutMs(timeoutMs) {
  const explicit = Number(timeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }

  const envValue = Number(process.env.IROSE_MEME_TIMEOUT_MS || '6000');
  if (Number.isFinite(envValue) && envValue > 0) {
    return Math.floor(envValue);
  }

  return 6000;
}

function normalizeEmotion(rawEmotion) {
  const value = String(rawEmotion || '').trim().slice(0, 24);
  if (!value) return '';
  if (SUPPORTED_EMOTIONS.has(value)) return value;

  const mapped = EMOTION_ALIASES.get(value.toLowerCase());
  return mapped || '';
}

function formatImageSegment(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/\[[^\]]+#e\]/i.test(value)) return value;
  if (value.endsWith('#e')) return `[${value}]`;
  return `[${value}#e]`;
}

async function replaceImageTags(text, options = {}) {
  if (typeof text !== 'string' || !IMAGE_TAG_TRIGGER_REGEX.test(text)) {
    return text;
  }

  const resolveImageByEmotion = typeof options.resolveImageByEmotion === 'function'
    ? options.resolveImageByEmotion
    : (() => Promise.resolve(''));
  const timeoutMs = getTimeoutMs(options.timeoutMs);
  const cache = new Map();

  let output = '';
  let lastIndex = 0;
  IMAGE_TAG_REGEX.lastIndex = 0;

  while (true) {
    const match = IMAGE_TAG_REGEX.exec(text);
    if (!match) break;

    const marker = match[0];
    const rawEmotion = match[1];
    const emotion = normalizeEmotion(rawEmotion);
    let replacement = marker;

    if (emotion) {
      let imageUrl = cache.get(emotion);
      if (imageUrl === undefined) {
        try {
          imageUrl = await resolveImageByEmotion(emotion, timeoutMs);
        } catch (error) {
          logger.WARN('MEME', `表情包检索失败(${emotion}): ${error.message}`);
          imageUrl = '';
        }
        cache.set(emotion, imageUrl || '');
      }

      const imageSegment = formatImageSegment(imageUrl);
      if (imageSegment) {
        replacement = imageSegment;
      }
    }

    output += text.slice(lastIndex, match.index);
    output += replacement;
    lastIndex = IMAGE_TAG_REGEX.lastIndex;
  }

  output += text.slice(lastIndex);
  return output;
}

function buildImageEmotionTag(emotion) {
  const normalized = normalizeEmotion(emotion);
  if (!normalized) return '';
  return `$image＝${normalized}$`;
}

function registerImageTagInterceptor(ctx, options = {}) {
  if (options.enabled === false) return;

  const timeoutMs = getTimeoutMs(options.timeoutMs);
  const resolveImageByEmotion = typeof options.resolveImageByEmotion === 'function'
    ? options.resolveImageByEmotion
    : ((emotion) => searchMemeByEmotion(emotion, timeoutMs));

  ctx.before('send', async (session) => {
    if (!Array.isArray(session?.elements) || session.elements.length === 0) {
      return;
    }

    let replacedCount = 0;
    for (const element of session.elements) {
      if (!element || element.type !== 'text') continue;
      const content = element.attrs?.content;
      if (typeof content !== 'string' || !content) continue;

      const replaced = await replaceImageTags(content, {
        resolveImageByEmotion,
        timeoutMs
      });

      if (replaced !== content) {
        element.attrs.content = replaced;
        replacedCount += 1;
      }
    }

    if (replacedCount > 0) {
      logger.INFO('MEME', `发送拦截完成，替换文本段数量: ${replacedCount}`);
    }
  });
}

module.exports = {
  IMAGE_TAG_REGEX,
  replaceImageTags,
  buildImageEmotionTag,
  registerImageTagInterceptor,
  normalizeEmotion
};
