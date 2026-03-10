/**
 * Music Skill
 * 点歌技能 - 使用 IIROSE 音乐卡片发送 (绕过 VIP)
 */

const https = require('https');
const http = require('http');

/**
 * 从网易云音乐 API 搜索歌曲
 */
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

/**
 * 获取歌曲详情（包含时长等信息）
 */
function getSongDetail(songId) {
  return new Promise((resolve, reject) => {
    const url = `https://music.163.com/api/song/detail?id=${songId}&ids=[${songId}]`;
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

/**
 * 获取非 VIP 播放链接（使用第三方 API 绕过限制）
 */
function getDirectPlayUrl(songId) {
  return new Promise((resolve) => {
    // 使用第三方 API 获取真实播放链接（绕过 VIP）
    const url = `https://api.injahow.cn/meting/?server=netease&type=url&id=${songId}`;
    const req = https.get({
      protocol: 'https:',
      hostname: 'api.injahow.cn',
      path: `/meting/?server=netease&type=url&id=${songId}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        resolve(res.headers.location);
      } else {
        resolve(`https://music.163.com/song/media/outer/url?id=${songId}.mp3`);
      }
    });
    req.on('error', () => {
      resolve(`https://music.163.com/song/media/outer/url?id=${songId}.mp3`);
    });
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(`https://music.163.com/song/media/outer/url?id=${songId}.mp3`);
    });
  });
}

/**
 * 创建音乐技能
 */
function createMusicSkill(skillManager) {
  return {
    name: 'music',
    keywords: ['点歌', '音乐', '歌曲', '听歌', 'play', 'music', 'song'],
    description: '点播网易云音乐歌曲',
    
    /**
     * 音乐处理器 - 使用 session.internal.makeMusic() 发送音乐卡片
     */
    handler: async ({ session, args }) => {
      try {
        const keyword = args?.query || args?.song || args?.keyword || '';
        
        if (!keyword) {
          return '🎵 请告诉我你想听什么歌~\n示例：@Bot 点歌 周杰伦 七里香';
        }
        
        // 搜索歌曲
        const songs = await searchNeteaseMusic(keyword);
        
        if (!songs || songs.length === 0) {
          return '😔 抱歉，没有找到相关的歌曲，换个关键词试试吧~';
        }
        
        // 取第一首
        const song = songs[0];
        const songId = song.id;
        const songName = song.name;
        const artistName = song.artists?.[0]?.name || '未知歌手';
        const albumName = song.album?.name || '';
        const coverUrl = song.album?.picUrl || '';
        const songPageUrl = `https://music.163.com/#/song?id=${songId}`;
        
        // 获取歌曲详情（时长等）
        let duration = 0;
        try {
          const detail = await getSongDetail(songId);
          if (detail) {
            duration = Math.floor(detail.duration / 1000); // 毫秒转秒
          }
        } catch (e) {
          duration = 240; // 默认 4 分钟
        }
        
        // 获取非 VIP 直接播放链接
        const playUrl = await getDirectPlayUrl(songId);
        
        // 使用 IIROSE 音乐卡片发送
        // 正确调用路径：session.bot.internal.makeMusic()
        if (session?.bot?.internal?.makeMusic) {
          session.bot.internal.makeMusic({
            type: 'music',
            name: songName,
            signer: artistName,
            cover: coverUrl,
            link: songPageUrl,
            url: playUrl,
            duration: duration,
            bitRate: 128,
            color: 'rgba(49, 31, 186, 1)',
            lyrics: '',
            origin: 'netease'
          });
          // 返回 null 表示已自行发送，不需要 index.js 再次发送
          return null;
        } else {
          // 降级方案：返回音频链接格式
          console.log('[MusicSkill] session.bot.internal.makeMusic 不可用，使用降级方案');
          return `@${playUrl}`;
        }
        
      } catch (error) {
        console.error('[MusicSkill] Error:', error.message);
        return '😔 点歌时出了点问题，请稍后再试~';
      }
    }
  };
}

module.exports = { createMusicSkill, searchNeteaseMusic, getDirectPlayUrl };
