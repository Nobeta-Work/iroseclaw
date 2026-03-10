/**
 * Meme Skill
 * 情绪 -> 第三方图库检索 -> 返回图片 URL（以 image segment 发送）
 */

const { parseMemePayload } = require('../../utils/meme-format');

function getTimeoutMs() {
  const envValue = Number(process.env.IROSE_MEME_TIMEOUT_MS || '6000');
  if (Number.isFinite(envValue) && envValue > 0) return Math.floor(envValue);
  return 6000;
}

function getRandomLocale() {
  return process.env.IROSE_MEME_LOCALE || 'zh-CN';
}

function getBlockedHostPatterns() {
  const envValue = process.env.IROSE_MEME_BLOCKED_HOSTS || '588ku.com,bpic.588ku.com,ibaotu.com,pic.ibaotu.com';
  return envValue
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  return getBlockedHostPatterns().some(pattern => host === pattern || host.endsWith(`.${pattern}`));
}

function normalizeQueryCandidates(emotion) {
  const mood = (emotion || '').trim();
  const base = mood || '表情包';
  const list = [`${base} 动漫 可爱`];

  const unique = [];
  for (const item of list) {
    const value = String(item || '').trim();
    if (!value || unique.includes(value)) continue;
    unique.push(value);
  }
  return unique;
}

async function fetchJsonWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function pickFirstUrl(values = []) {
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        continue;
      }
      if (isBlockedHost(parsed.hostname)) {
        continue;
      }
      if (parsed.hostname.includes('bing.net')) {
        continue;
      }
      if (parsed.hostname.includes('mm.bing.net')) {
        continue;
      }
      if (parsed.hostname.includes('588ku.com')) {
        continue;
      }
      if (parsed.pathname && /\.(svg)(?:$|\?)/i.test(parsed.pathname)) {
        continue;
      }
      if (parsed.pathname && parsed.pathname.length > 1) {
        return parsed.href;
      }
    } catch {
      // ignore invalid url
    }
  }
  return '';
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function searchBingImage(query, timeoutMs) {
  const first = Math.floor(Math.random() * 16) + 1;
  const params = new URLSearchParams({
    q: query,
    form: 'HDRSC2',
    first: String(first)
  });

  const html = await fetchTextWithTimeout(`https://cn.bing.com/images/search?${params.toString()}`, timeoutMs, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  if (!html) return '';

  const imageUrls = [];
  const mAttrMatches = html.match(/m=\"\{&quot;[\s\S]*?\}\"/g) || [];

  for (const raw of mAttrMatches) {
    const start = raw.indexOf('"');
    const end = raw.lastIndexOf('"');
    if (start < 0 || end <= start) continue;

    const encodedJson = raw.slice(start + 1, end);
    const decoded = decodeHtmlEntities(encodedJson);
    try {
      const payload = JSON.parse(decoded);
      imageUrls.push(payload?.murl);
    } catch {
      // ignore malformed item
    }
  }

  return pickFirstUrl(imageUrls);
}

async function searchTenor(query, timeoutMs) {
  const key = process.env.TENOR_API_KEY || process.env.IROSE_TENOR_API_KEY || 'LIVDSRZULELA';
  if (!key) return '';

  const params = new URLSearchParams({
    key,
    q: query,
    limit: '3',
    media_filter: 'gif',
    locale: getRandomLocale(),
    contentfilter: 'medium'
  });

  const data = await fetchJsonWithTimeout(`https://tenor.googleapis.com/v2/search?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.results) || data.results.length === 0) return '';

  const candidateUrls = [];
  for (const item of data.results) {
    const media = item?.media_formats || {};
    candidateUrls.push(
      media?.gif?.url,
      media?.tinygif?.url,
      media?.nanogif?.url
    );
  }
  return pickFirstUrl(candidateUrls);
}

async function searchGiphy(query, timeoutMs) {
  const key = process.env.GIPHY_API_KEY || process.env.IROSE_GIPHY_API_KEY || '';
  if (!key) return '';

  const params = new URLSearchParams({
    api_key: key,
    q: query,
    limit: '3',
    offset: '0',
    rating: 'pg-13',
    lang: 'zh-CN'
  });

  const data = await fetchJsonWithTimeout(`https://api.giphy.com/v1/gifs/search?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.data) || data.data.length === 0) return '';

  const candidateUrls = [];
  for (const item of data.data) {
    const images = item?.images || {};
    candidateUrls.push(
      images?.original?.url,
      images?.downsized?.url,
      images?.fixed_height?.url
    );
  }
  return pickFirstUrl(candidateUrls);
}

async function searchPexels(query, timeoutMs) {
  const key = process.env.PEXELS_API_KEY || process.env.IROSE_PEXELS_API_KEY || '';
  if (!key) return '';

  const params = new URLSearchParams({
    query,
    per_page: '3',
    orientation: 'landscape'
  });

  const data = await fetchJsonWithTimeout(`https://api.pexels.com/v1/search?${params.toString()}`, timeoutMs, {
    Authorization: key
  });
  if (!data || !Array.isArray(data.photos) || data.photos.length === 0) return '';

  const candidateUrls = [];
  for (const photo of data.photos) {
    const src = photo?.src || {};
    candidateUrls.push(src?.large, src?.medium, src?.original);
  }
  return pickFirstUrl(candidateUrls);
}

async function searchPixabay(query, timeoutMs) {
  const key = process.env.PIXABAY_API_KEY || process.env.IROSE_PIXABAY_API_KEY || '';
  if (!key) return '';

  const params = new URLSearchParams({
    key,
    q: query,
    image_type: 'photo',
    per_page: '3',
    safesearch: 'true'
  });

  const data = await fetchJsonWithTimeout(`https://pixabay.com/api/?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.hits) || data.hits.length === 0) return '';

  const candidateUrls = [];
  for (const hit of data.hits) {
    candidateUrls.push(hit?.webformatURL, hit?.largeImageURL, hit?.previewURL);
  }
  return pickFirstUrl(candidateUrls);
}

async function searchMemeByEmotion(emotion, timeoutMs) {
  const queries = normalizeQueryCandidates(emotion);
  const providers = [searchBingImage, searchTenor, searchGiphy, searchPexels, searchPixabay];

  for (const query of queries) {
    for (const provider of providers) {
      const url = await provider(query, timeoutMs);
      if (url) return url;
    }
  }

  return '';
}

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
