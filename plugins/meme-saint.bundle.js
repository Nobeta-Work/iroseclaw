/**
 * iroseclaw remote plugin bundle
 * saint meme search plugin (single-file, sharable)
 */

const MEME_PAYLOAD_PREFIX = '#MEME_V1#';

function getTimeoutMs() {
  const envValue = Number(process.env.IROSE_MEME_TIMEOUT_MS || '6000');
  if (Number.isFinite(envValue) && envValue > 0) return Math.floor(envValue);
  return 6000;
}

function getStyleKeyword() {
  return (process.env.IROSE_MEME_STYLE_KEYWORD || '楠娘').trim() || '楠娘';
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

function parseMemePayload(value) {
  if (typeof value !== 'string' || !value.trim()) return { emotion: '', text: '' };
  const raw = value.trim();
  if (!raw.startsWith(MEME_PAYLOAD_PREFIX)) return { emotion: '', text: raw };

  try {
    const data = JSON.parse(raw.slice(MEME_PAYLOAD_PREFIX.length).trim() || '{}');
    return {
      emotion: typeof data?.emotion === 'string' ? data.emotion.trim() : '',
      text: typeof data?.text === 'string' ? data.text : ''
    };
  } catch {
    return { emotion: '', text: '' };
  }
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
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
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
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
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
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (isBlockedHost(parsed.hostname)) continue;
      if (parsed.hostname.includes('bing.net')) continue;
      if (parsed.hostname.includes('mm.bing.net')) continue;
      if (parsed.pathname && /\.(svg)(?:$|\?)/i.test(parsed.pathname)) continue;
      if (!parsed.pathname || parsed.pathname.length <= 1) continue;
      return parsed.href;
    } catch {
      // ignore
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
  const params = new URLSearchParams({ q: query, form: 'HDRSC2', first: String(first) });
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
    const decoded = decodeHtmlEntities(raw.slice(start + 1, end));
    try {
      const payload = JSON.parse(decoded);
      imageUrls.push(payload?.murl);
    } catch {
      // ignore
    }
  }

  return pickFirstUrl(imageUrls);
}

async function searchTenor(query, timeoutMs) {
  const key = process.env.TENOR_API_KEY || process.env.IROSE_TENOR_API_KEY || 'LIVDSRZULELA';
  if (!key) return '';
  const params = new URLSearchParams({
    key, q: query, limit: '3', media_filter: 'gif', locale: process.env.IROSE_MEME_LOCALE || 'zh-CN', contentfilter: 'medium'
  });
  const data = await fetchJsonWithTimeout(`https://tenor.googleapis.com/v2/search?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.results)) return '';
  const urls = [];
  for (const item of data.results) {
    const media = item?.media_formats || {};
    urls.push(media?.gif?.url, media?.tinygif?.url, media?.nanogif?.url);
  }
  return pickFirstUrl(urls);
}

async function searchGiphy(query, timeoutMs) {
  const key = process.env.GIPHY_API_KEY || process.env.IROSE_GIPHY_API_KEY || '';
  if (!key) return '';
  const params = new URLSearchParams({
    api_key: key, q: query, limit: '3', offset: '0', rating: 'pg-13', lang: 'zh-CN'
  });
  const data = await fetchJsonWithTimeout(`https://api.giphy.com/v1/gifs/search?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.data)) return '';
  const urls = [];
  for (const item of data.data) {
    const images = item?.images || {};
    urls.push(images?.original?.url, images?.downsized?.url, images?.fixed_height?.url);
  }
  return pickFirstUrl(urls);
}

async function searchPexels(query, timeoutMs) {
  const key = process.env.PEXELS_API_KEY || process.env.IROSE_PEXELS_API_KEY || '';
  if (!key) return '';
  const params = new URLSearchParams({ query, per_page: '3', orientation: 'landscape' });
  const data = await fetchJsonWithTimeout(`https://api.pexels.com/v1/search?${params.toString()}`, timeoutMs, {
    Authorization: key
  });
  if (!data || !Array.isArray(data.photos)) return '';
  const urls = [];
  for (const photo of data.photos) {
    const src = photo?.src || {};
    urls.push(src?.large, src?.medium, src?.original);
  }
  return pickFirstUrl(urls);
}

async function searchPixabay(query, timeoutMs) {
  const key = process.env.PIXABAY_API_KEY || process.env.IROSE_PIXABAY_API_KEY || '';
  if (!key) return '';
  const params = new URLSearchParams({
    key, q: query, image_type: 'photo', per_page: '3', safesearch: 'true'
  });
  const data = await fetchJsonWithTimeout(`https://pixabay.com/api/?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.hits)) return '';
  const urls = [];
  for (const item of data.hits) {
    urls.push(item?.webformatURL, item?.largeImageURL, item?.previewURL);
  }
  return pickFirstUrl(urls);
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

module.exports = {
  name: 'meme',
  keywords: [],
  description: '根据情绪检索楠娘表情包（remote bundle）',
  handler: async ({ args }) => {
    const parsed = parseMemePayload(args?.format || args?.query || args?.raw || '');
    const emotion = (args?.emotion || parsed.emotion || '').trim();
    const text = typeof args?.text === 'string' ? args.text : parsed.text;
    if (!emotion) return text || null;

    const imageUrl = await searchMemeByEmotion(emotion, getTimeoutMs());
    if (!imageUrl) return text || null;

    const imageSegment = `[${imageUrl}#e]`;
    return text && text.trim() ? `${text.trim()}\n${imageSegment}` : imageSegment;
  }
};
