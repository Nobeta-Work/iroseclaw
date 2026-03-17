/**
 * Live meme search test
 * 手动联网测试当前启用的表情包搜索引擎（当前仅 Bing）
 */

const { searchMemeByEmotion } = require('../src/skills/base/meme');

function normalizeTimeoutMs(value, fallback = 6000) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function isUrlShaped(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (parsed.hostname.includes('bing.net')) return false;
    if (parsed.hostname.includes('mm.bing.net')) return false;
    return Boolean(parsed.pathname && parsed.pathname.length > 1);
  } catch {
    return false;
  }
}

async function probeImageUrl(url, timeoutMs) {
  if (!isUrlShaped(url)) return { passed: false, reason: 'invalid-url' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return {
        passed: false,
        reason: `http-${response.status}`
      };
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      return {
        passed: false,
        reason: `content-type:${contentType}`
      };
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      return {
        passed: true,
        reason: contentType || 'ok'
      };
    }

    const firstChunk = await reader.read();
    await reader.cancel();

    return {
      passed: !firstChunk.done && firstChunk.value instanceof Uint8Array && firstChunk.value.length > 0,
      reason: !firstChunk.done ? (contentType || 'ok') : 'empty-body'
    };
  } catch (error) {
    return {
      passed: false,
      reason: error.name === 'AbortError' ? 'timeout' : (error.message || 'fetch-error')
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const emotions = process.argv.slice(2);
  const targets = emotions.length > 0 ? emotions : ['开心', '难过', '疑惑'];
  const timeoutMs = normalizeTimeoutMs(process.env.IROSE_MEME_TIMEOUT_MS, 6000);

  let failed = 0;

  for (const emotion of targets) {
    const startedAt = Date.now();
    const imageUrl = await searchMemeByEmotion(emotion, timeoutMs);
    const probe = await probeImageUrl(imageUrl, timeoutMs);
    const elapsedMs = Date.now() - startedAt;
    const passed = probe.passed;

    if (!passed) {
      failed += 1;
    }

    console.log(JSON.stringify({
      emotion,
      passed,
      elapsedMs,
      imageUrl: imageUrl || '',
      reason: probe.reason
    }));
  }

  if (failed > 0) {
    console.error(`Live meme search failed for ${failed} emotion(s).`);
    process.exit(1);
  }

  console.log('Live meme search passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
