/**
 * Music play-url providers
 * 将搜歌与播放地址来源解耦
 *
 * Attribution:
 * - The `iarcDirect` provider references the public playback URL pattern observed in
 *   IIROSE-MEDIA-WEB by jingming295:
 *   https://github.com/jingming295/IIROSE-MEDIA-WEB
 * - Current bot-side implementation does NOT load, import, execute, or bundle the
 *   project's browser plugin code, UI, DOM logic, localStorage settings, WebSocket
 *   sender, encrypted search implementation, or other internal core logic.
 * - The only reused idea in this provider is the public third-party URL template:
 *   https://v.iarc.top/?type=url&id={{id}}#.mp3
 */

const https = require('https');
const http = require('http');
const { loadRuntimeConfig } = require('../../config/runtime');
const logger = require('../../utils/logger');

const DEFAULT_PROVIDER_ORDER = ['iarcDirect', 'metingRedirect', 'neteaseOuter'];

function getMusicProviderConfig(explicitConfig = null) {
  const runtimeConfig = explicitConfig && typeof explicitConfig === 'object'
    ? explicitConfig
    : loadRuntimeConfig();
  const musicConfig = runtimeConfig.music && typeof runtimeConfig.music === 'object'
    ? runtimeConfig.music
    : runtimeConfig;

  return {
    playUrlProviders: Array.isArray(musicConfig.playUrlProviders) && musicConfig.playUrlProviders.length > 0
      ? [...musicConfig.playUrlProviders]
      : [...DEFAULT_PROVIDER_ORDER],
    providers: {
      customTemplate: {
        enabled: musicConfig.providers?.customTemplate?.enabled === true,
        urlTemplate: typeof musicConfig.providers?.customTemplate?.urlTemplate === 'string'
          ? musicConfig.providers.customTemplate.urlTemplate.trim()
          : ''
      },
      iarcDirect: {
        enabled: musicConfig.providers?.iarcDirect?.enabled !== false,
        urlTemplate: typeof musicConfig.providers?.iarcDirect?.urlTemplate === 'string' &&
          musicConfig.providers.iarcDirect.urlTemplate.trim()
          ? musicConfig.providers.iarcDirect.urlTemplate.trim()
          : 'https://v.iarc.top/?type=url&id={{id}}#.mp3'
      },
      metingRedirect: {
        enabled: musicConfig.providers?.metingRedirect?.enabled !== false,
        endpointTemplate: typeof musicConfig.providers?.metingRedirect?.endpointTemplate === 'string' &&
          musicConfig.providers.metingRedirect.endpointTemplate.trim()
          ? musicConfig.providers.metingRedirect.endpointTemplate.trim()
          : 'https://api.injahow.cn/meting/?server=netease&type=url&id={{id}}'
      },
      neteaseOuter: {
        enabled: musicConfig.providers?.neteaseOuter?.enabled !== false,
        urlTemplate: typeof musicConfig.providers?.neteaseOuter?.urlTemplate === 'string' &&
          musicConfig.providers.neteaseOuter.urlTemplate.trim()
          ? musicConfig.providers.neteaseOuter.urlTemplate.trim()
          : 'https://music.163.com/song/media/outer/url?id={{id}}.mp3'
      }
    }
  };
}

function interpolateTemplate(template, params = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractUrlHost(value) {
  if (!isHttpUrl(value)) return '';
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function resolveCustomTemplateProvider(songId, providerConfig) {
  if (!providerConfig?.enabled || !providerConfig?.urlTemplate) {
    return '';
  }

  const url = interpolateTemplate(providerConfig.urlTemplate, { id: songId });
  return isHttpUrl(url) ? url : '';
}

function resolveNeteaseOuterProvider(songId, providerConfig) {
  if (!providerConfig?.enabled || !providerConfig?.urlTemplate) {
    return '';
  }

  const url = interpolateTemplate(providerConfig.urlTemplate, { id: songId });
  return isHttpUrl(url) ? url : '';
}

function resolveIarcDirectProvider(songId, providerConfig) {
  if (!providerConfig?.enabled || !providerConfig?.urlTemplate) {
    return '';
  }

  // Reference source:
  // https://github.com/jingming295/IIROSE-MEDIA-WEB
  // This bot-side provider only interpolates the public third-party URL pattern.
  // It does not execute or embed the original client plugin implementation.
  const url = interpolateTemplate(providerConfig.urlTemplate, { id: songId });
  return isHttpUrl(url) ? url : '';
}

function fetchMetingRedirect(endpoint) {
  return new Promise((resolve) => {
    if (!isHttpUrl(endpoint)) {
      resolve('');
      return;
    }

    const url = new URL(endpoint);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const location = typeof res.headers.location === 'string' ? res.headers.location.trim() : '';
        if ((res.statusCode === 301 || res.statusCode === 302) && isHttpUrl(location)) {
          resolve(location);
          return;
        }

        const bodyText = String(data || '').trim();
        if (isHttpUrl(bodyText)) {
          resolve(bodyText);
          return;
        }

        resolve('');
      });
    });

    req.on('error', () => resolve(''));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve('');
    });
  });
}

async function resolveMetingRedirectProvider(songId, providerConfig) {
  if (!providerConfig?.enabled || !providerConfig?.endpointTemplate) {
    return '';
  }

  const endpoint = interpolateTemplate(providerConfig.endpointTemplate, { id: songId });
  return fetchMetingRedirect(endpoint);
}

async function resolvePlayUrl(songId, explicitConfig = null) {
  const config = getMusicProviderConfig(explicitConfig);

  for (const providerId of config.playUrlProviders) {
    if (providerId === 'customTemplate') {
      const url = resolveCustomTemplateProvider(songId, config.providers.customTemplate);
      if (url) {
        logger.INFO('MUSIC', `provider hit provider=${providerId} songId=${songId} host=${extractUrlHost(url)}`);
        return { url, provider: providerId };
      }
      continue;
    }

    if (providerId === 'metingRedirect') {
      const url = await resolveMetingRedirectProvider(songId, config.providers.metingRedirect);
      if (url) {
        logger.INFO('MUSIC', `provider hit provider=${providerId} songId=${songId} host=${extractUrlHost(url)}`);
        return { url, provider: providerId };
      }
      continue;
    }

    if (providerId === 'iarcDirect') {
      const url = resolveIarcDirectProvider(songId, config.providers.iarcDirect);
      if (url) {
        logger.INFO('MUSIC', `provider hit provider=${providerId} songId=${songId} host=${extractUrlHost(url)}`);
        return { url, provider: providerId };
      }
      continue;
    }

    if (providerId === 'neteaseOuter') {
      const url = resolveNeteaseOuterProvider(songId, config.providers.neteaseOuter);
      if (url) {
        logger.INFO('MUSIC', `provider hit provider=${providerId} songId=${songId} host=${extractUrlHost(url)}`);
        return { url, provider: providerId };
      }
    }
  }

  const fallbackUrl = resolveNeteaseOuterProvider(songId, config.providers.neteaseOuter);
  logger.WARN('MUSIC', `provider fallback songId=${songId} host=${extractUrlHost(fallbackUrl) || 'none'}`);
  return {
    url: fallbackUrl,
    provider: 'fallback'
  };
}

module.exports = {
  DEFAULT_PROVIDER_ORDER,
  getMusicProviderConfig,
  interpolateTemplate,
  resolvePlayUrl,
  extractUrlHost
};
