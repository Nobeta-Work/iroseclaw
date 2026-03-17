/**
 * Netease music service
 * 封装点歌查询和 IIROSE 音乐卡片发送
 */

const https = require('https');
const http = require('http');
const logger = require('../../utils/logger');
const { resolvePlayUrl, extractUrlHost } = require('./providers');

function searchNeteaseMusic(keyword) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=5`);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get({
      protocol: url.protocol,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.code === 200 && result.result && result.result.songs) {
            resolve(result.result.songs);
          } else {
            resolve([]);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('搜索超时'));
    });
  });
}

function getSongDetail(songId) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      protocol: 'https:',
      hostname: 'music.163.com',
      path: `/api/song/detail?id=${songId}&ids=[${songId}]`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.code === 200 && result.songs && result.songs.length > 0) {
            resolve(result.songs[0]);
          } else {
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('获取详情超时'));
    });
  });
}

async function getDirectPlayUrl(songId, musicConfig = null) {
  const resolved = await resolvePlayUrl(songId, musicConfig);
  return resolved?.url || '';
}

async function resolveSongCard(keyword, musicConfig = null) {
  if (!keyword) {
    return {
      ok: false,
      message: '🎵 请告诉我你想听什么歌~\n示例：@Bot 点歌 周杰伦 七里香'
    };
  }

  const songs = await searchNeteaseMusic(keyword);
  if (!songs || songs.length === 0) {
    return {
      ok: false,
      message: '😔 抱歉，没有找到相关的歌曲，换个关键词试试吧~'
    };
  }

  const song = songs[0];
  const songId = song.id;
  const songName = song.name;
  const artistName = song.artists?.[0]?.name || '未知歌手';
  const coverUrl = song.album?.picUrl || '';
  const songPageUrl = `https://music.163.com/#/song?id=${songId}`;
  const fee = Number(song.fee);

  let duration = 0;
  try {
    const detail = await getSongDetail(songId);
    if (detail) {
      duration = Math.floor(detail.duration / 1000);
    }
  } catch {
    duration = 240;
  }

  const providerResult = await resolvePlayUrl(songId, musicConfig);
  const playUrl = providerResult?.url || '';
  const provider = providerResult?.provider || 'unknown';
  const urlHost = extractUrlHost(playUrl);

  logger.INFO(
    'MUSIC',
    `resolved keyword="${keyword}" songId=${songId} name="${songName}" artist="${artistName}" fee=${Number.isFinite(fee) ? fee : 'unknown'} duration=${duration}s provider=${provider} host=${urlHost || 'none'}`
  );

  return {
    ok: true,
    songId,
    provider,
    playUrlHost: urlHost,
    fee: Number.isFinite(fee) ? fee : null,
    card: {
      type: 'music',
      name: songName,
      signer: artistName,
      cover: coverUrl,
      link: songPageUrl,
      url: playUrl,
      duration,
      bitRate: 128,
      color: 'rgba(49, 31, 186, 1)',
      lyrics: '',
      origin: 'netease'
    }
  };
}

async function playSongInSessionDetailed(session, keyword, musicConfig = null) {
  try {
    const resolved = await resolveSongCard(keyword, musicConfig);
    if (!resolved.ok) {
      return {
        ok: false,
        query: keyword || '',
        replyText: resolved.message,
        error: resolved.message,
        songId: '',
        songName: '',
        artistName: '',
        provider: '',
        playUrlHost: '',
        card: null
      };
    }

    if (session?.bot?.internal?.makeMusic) {
      logger.INFO(
        'MUSIC',
        `dispatch makeMusic songId=${resolved.songId || 'unknown'} provider=${resolved.provider || 'unknown'} host=${resolved.playUrlHost || 'none'}`
      );
      session.bot.internal.makeMusic(resolved.card);
      return {
        ok: true,
        query: keyword || '',
        replyText: `已开始播放《${resolved.card.name}》 - ${resolved.card.signer}`,
        error: '',
        songId: resolved.songId,
        songName: resolved.card.name,
        artistName: resolved.card.signer,
        provider: resolved.provider || '',
        playUrlHost: resolved.playUrlHost || '',
        card: resolved.card,
        usedMusicCard: true
      };
    }

    logger.WARN(
      'MUSIC',
      `makeMusic unavailable, fallback to plain url songId=${resolved.songId || 'unknown'} provider=${resolved.provider || 'unknown'} host=${resolved.playUrlHost || 'none'}`
    );
    return {
      ok: true,
      query: keyword || '',
      replyText: `@${resolved.card.url}`,
      error: '',
      songId: resolved.songId,
      songName: resolved.card.name,
      artistName: resolved.card.signer,
      provider: resolved.provider || '',
      playUrlHost: resolved.playUrlHost || '',
      card: resolved.card,
      usedMusicCard: false
    };
  } catch (error) {
    logger.ERROR('MUSIC', `playSongInSession failed: ${error.message}`);
    return {
      ok: false,
      query: keyword || '',
      replyText: '😔 点歌时出了点问题，请稍后再试~',
      error: error.message,
      songId: '',
      songName: '',
      artistName: '',
      provider: '',
      playUrlHost: '',
      card: null
    };
  }
}

async function playSongInSession(session, keyword, musicConfig = null) {
  const result = await playSongInSessionDetailed(session, keyword, musicConfig);
  if (!result.ok) {
    return result.replyText || '😔 点歌时出了点问题，请稍后再试~';
  }
  if (result.usedMusicCard) {
    return null;
  }
  return result.replyText || null;
}

module.exports = {
  searchNeteaseMusic,
  getDirectPlayUrl,
  resolveSongCard,
  playSongInSessionDetailed,
  playSongInSession
};
