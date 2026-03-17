/**
 * Meme format helpers
 * 统一情绪标签提取与插件载荷格式
 */

const MEME_PAYLOAD_PREFIX = '#MEME_V1#';

function sanitizeEmotion(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 24);
}

function extractJsonEmotionPayload(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return null;

  try {
    const data = JSON.parse(raw);
    const emotion = sanitizeEmotion(
      data?.emotion || data?.mood || data?.sentiment || ''
    );
    const replyText = typeof data?.replyText === 'string'
      ? data.replyText
      : (typeof data?.reply === 'string' ? data.reply : (typeof data?.text === 'string' ? data.text : ''));
    return {
      emotion,
      text: replyText.trim()
    };
  } catch {
    return null;
  }
}

function extractEmotionFromReply(replyText) {
  const fallback = {
    text: typeof replyText === 'string' ? replyText.trim() : '',
    emotion: ''
  };

  if (typeof replyText !== 'string' || !replyText.trim()) {
    return fallback;
  }

  const jsonPayload = extractJsonEmotionPayload(replyText);
  if (jsonPayload && (jsonPayload.text || jsonPayload.emotion)) {
    return jsonPayload;
  }

  let text = replyText;
  let emotion = '';

  const tagPatterns = [
    /\[\[(?:EMO|EMOTION|MOOD):([^[\]]+)\]\]/i,
    /\[(?:EMO|EMOTION|MOOD):([^[\]]+)\]/i,
    /<(?:emo|emotion|mood):([^<>]+)>/i
  ];

  for (const pattern of tagPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    emotion = sanitizeEmotion(match[1] || '');
    text = text.replace(pattern, '').trim();
    if (emotion) break;
  }

  return {
    text: text.trim(),
    emotion
  };
}

function resolveReplyOutput(replyText) {
  const parsed = extractEmotionFromReply(replyText);
  if (parsed.text) {
    return parsed;
  }

  return {
    text: parsed.emotion ? '' : (typeof replyText === 'string' ? replyText.trim() : ''),
    emotion: parsed.emotion
  };
}

function inferEmotionFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const value = text.toLowerCase();

  const dictionary = [
    { emotion: '开心', keywords: ['哈哈', '开心', '高兴', '太棒', '真好', 'nice', 'happy', '棒'] },
    { emotion: '难过', keywords: ['难过', '伤心', '呜呜', 'sad', '哭', '可惜'] },
    { emotion: '生气', keywords: ['生气', '气死', '怒', '愤怒', 'angry', '火大'] },
    { emotion: '无语', keywords: ['无语', '离谱', '尴尬', '…', 'emmm'] },
    { emotion: '疑惑', keywords: ['为什么', '啥', '？', '?', '疑惑', '不懂'] },
    { emotion: '调皮', keywords: ['嘿嘿', '坏笑', '皮', '逗', '玩笑'] },
    { emotion: '安慰', keywords: ['别担心', '没事', '加油', '抱抱', '安慰'] },
    { emotion: '惊讶', keywords: ['震惊', '居然', '竟然', '惊讶', '真的假的', 'wow'] }
  ];

  for (const entry of dictionary) {
    if (entry.keywords.some(keyword => value.includes(keyword.toLowerCase()))) {
      return entry.emotion;
    }
  }

  return '';
}

function buildMemePayload({ emotion, text = '' }) {
  const payload = {
    emotion: sanitizeEmotion(emotion),
    text: typeof text === 'string' ? text : String(text ?? '')
  };
  return `${MEME_PAYLOAD_PREFIX}${JSON.stringify(payload)}`;
}

function parseMemePayload(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { emotion: '', text: '' };
  }

  const raw = value.trim();
  if (!raw.startsWith(MEME_PAYLOAD_PREFIX)) {
    return {
      emotion: '',
      text: raw
    };
  }

  const jsonPart = raw.slice(MEME_PAYLOAD_PREFIX.length).trim();
  if (!jsonPart) return { emotion: '', text: '' };

  try {
    const data = JSON.parse(jsonPart);
    return {
      emotion: sanitizeEmotion(data?.emotion || ''),
      text: typeof data?.text === 'string' ? data.text : ''
    };
  } catch {
    return { emotion: '', text: '' };
  }
}

module.exports = {
  MEME_PAYLOAD_PREFIX,
  extractEmotionFromReply,
  resolveReplyOutput,
  inferEmotionFromText,
  buildMemePayload,
  parseMemePayload
};
