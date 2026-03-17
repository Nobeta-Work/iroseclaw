/**
 * iroseclaw distributable plugin bundle
 * send-time image tag interceptor
 *
 * Usage:
 * 1) Chat sends "$image=开心$" (or "$image＝开心$")
 * 2) Plugin intercepts before-send and replaces marker with "[url#e]"
 */

function getTimeoutMs(configTimeout) {
  const explicit = Number(configTimeout);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const envValue = Number(process.env.IROSE_MEME_TIMEOUT_MS || '6000');
  if (Number.isFinite(envValue) && envValue > 0) return Math.floor(envValue);
  return 6000;
}

function getStyleKeyword(styleKeyword) {
  if (typeof styleKeyword === 'string' && styleKeyword.trim()) {
    return styleKeyword.trim();
  }
  return (process.env.IROSE_MEME_STYLE_KEYWORD || '楠娘').trim() || '楠娘';
}

function getBlockedHostPatterns(blockedHosts) {
  const source = typeof blockedHosts === 'string' && blockedHosts.trim()
    ? blockedHosts
    : (process.env.IROSE_MEME_BLOCKED_HOSTS || '588ku.com,bpic.588ku.com,ibaotu.com,pic.ibaotu.com');
  return source
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function isBlockedHost(hostname, blockedHosts) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  return blockedHosts.some(pattern => host === pattern || host.endsWith(`.${pattern}`));
}

function normalizeQueryCandidates(emotion, styleKeyword) {
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

async function fetchJsonWithTimeout(url, timeoutMs, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers || {},
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

async function fetchTextWithTimeout(url, timeoutMs, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers || {},
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

function pickFirstUrl(values, blockedHosts) {
  const list = Array.isArray(values) ? values : [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (isBlockedHost(parsed.hostname, blockedHosts)) continue;
      if (parsed.hostname.includes('bing.net') || parsed.hostname.includes('mm.bing.net')) continue;
      if (parsed.pathname && /\.(svg)(?:$|\?)/i.test(parsed.pathname)) continue;
      if (parsed.pathname && parsed.pathname.length > 1) return parsed.href;
    } catch {
      // ignore malformed URL
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

async function searchBingImage(query, timeoutMs, blockedHosts) {
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
      imageUrls.push(payload && payload.murl);
    } catch {
      // ignore malformed payload
    }
  }
  return pickFirstUrl(imageUrls, blockedHosts);
}

async function searchTenor(query, timeoutMs, blockedHosts, locale) {
  const key = process.env.TENOR_API_KEY || process.env.IROSE_TENOR_API_KEY || 'LIVDSRZULELA';
  if (!key) return '';
  const params = new URLSearchParams({
    key,
    q: query,
    limit: '3',
    media_filter: 'gif',
    locale: locale || process.env.IROSE_MEME_LOCALE || 'zh-CN',
    contentfilter: 'medium'
  });
  const data = await fetchJsonWithTimeout(`https://tenor.googleapis.com/v2/search?${params.toString()}`, timeoutMs);
  if (!data || !Array.isArray(data.results) || data.results.length === 0) return '';
  const urls = [];
  for (const item of data.results) {
    const media = item && item.media_formats ? item.media_formats : {};
    urls.push(media.gif && media.gif.url, media.tinygif && media.tinygif.url, media.nanogif && media.nanogif.url);
  }
  return pickFirstUrl(urls, blockedHosts);
}

async function searchGiphy(query, timeoutMs, blockedHosts) {
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
  const urls = [];
  for (const item of data.data) {
    const images = item && item.images ? item.images : {};
    urls.push(
      images.original && images.original.url,
      images.downsized && images.downsized.url,
      images.fixed_height && images.fixed_height.url
    );
  }
  return pickFirstUrl(urls, blockedHosts);
}

async function searchPexels(query, timeoutMs, blockedHosts) {
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
  const urls = [];
  for (const photo of data.photos) {
    const src = photo && photo.src ? photo.src : {};
    urls.push(src.large, src.medium, src.original);
  }
  return pickFirstUrl(urls, blockedHosts);
}

async function searchPixabay(query, timeoutMs, blockedHosts) {
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
  const urls = [];
  for (const hit of data.hits) {
    urls.push(hit && hit.webformatURL, hit && hit.largeImageURL, hit && hit.previewURL);
  }
  return pickFirstUrl(urls, blockedHosts);
}

async function searchMemeByEmotion(emotion, options) {
  const queries = normalizeQueryCandidates(emotion, options.styleKeyword);
  const providers = [searchBingImage, searchTenor, searchGiphy, searchPexels, searchPixabay];
  for (const query of queries) {
    for (const provider of providers) {
      const url = await provider(query, options.timeoutMs, options.blockedHosts, options.locale);
      if (url) return url;
    }
  }
  return '';
}

function formatImageSegment(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/\[[^\]]+#e\]/i.test(value)) return value;
  if (value.endsWith('#e')) return `[${value}]`;
  return `[${value}#e]`;
}

const TAG_REGEX = /\$image\s*[=＝]\s*([^\r\n$]{1,24})\$/gi;
const TRIGGER_REGEX = /\$image\s*[=＝]\s*[^\r\n$]{1,24}\$/i;

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

function normalizeEmotion(value) {
  const text = String(value || '').trim().slice(0, 24);
  if (!text) return '';
  if (SUPPORTED_EMOTIONS.has(text)) return text;
  const mapped = EMOTION_ALIASES.get(text.toLowerCase());
  return mapped || '';
}

async function replaceImageTags(text, options) {
  if (typeof text !== 'string' || !TRIGGER_REGEX.test(text)) return text;
  const cache = new Map();
  TAG_REGEX.lastIndex = 0;
  let output = '';
  let lastIndex = 0;

  while (true) {
    const match = TAG_REGEX.exec(text);
    if (!match) break;
    const marker = match[0];
    const rawEmotion = match[1];
    const emotion = normalizeEmotion(rawEmotion);
    let replacement = marker;

    if (emotion) {
      let imageUrl = cache.get(emotion);
      if (imageUrl === undefined) {
        imageUrl = await searchMemeByEmotion(emotion, options);
        cache.set(emotion, imageUrl || '');
      }
      const segment = formatImageSegment(imageUrl);
      if (segment) replacement = segment;
    }

    output += text.slice(lastIndex, match.index) + replacement;
    lastIndex = TAG_REGEX.lastIndex;
  }

  output += text.slice(lastIndex);
  return output;
}

module.exports = {
  name: 'image-tag-interceptor',
  reusable: true,
  apply(ctx, config) {
    const options = {
      timeoutMs: getTimeoutMs(config && config.timeoutMs),
      locale: (config && config.locale) || process.env.IROSE_MEME_LOCALE || 'zh-CN',
      styleKeyword: getStyleKeyword(config && config.styleKeyword),
      blockedHosts: getBlockedHostPatterns(config && config.blockedHosts)
    };

    ctx.before('send', async (session) => {
      if (!Array.isArray(session && session.elements) || session.elements.length === 0) return;

      let replacedCount = 0;
      for (const element of session.elements) {
        if (!element || element.type !== 'text') continue;
        const content = element.attrs && element.attrs.content;
        if (typeof content !== 'string' || !content) continue;
        const replaced = await replaceImageTags(content, options);
        if (replaced !== content) {
          element.attrs.content = replaced;
          replacedCount += 1;
        }
      }

      if (replacedCount > 0) {
        const logger = ctx.logger ? ctx.logger('image-tag-interceptor') : console;
        if (logger.info) logger.info(`replaced image tags: ${replacedCount}`);
      }
    });
  },
  _internal: {
    replaceImageTags,
    normalizeEmotion
  }
};
