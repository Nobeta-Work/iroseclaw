/**
 * Builtin plugin: music tool
 */

const { createMusicPlayNeteaseTool } = require('../../../tools/builtins/music-play-netease');
const musicService = require('../../../services/music/netease');

module.exports = {
  name: 'builtin-music',
  apply(host, context) {
    host.registerService('music.netease', musicService);
    context.registerToolPackage({
      name: 'builtin-music-package',
      version: '0.2.0',
      tools: [
        createMusicPlayNeteaseTool({
          musicConfig: context.config.music || {}
        })
      ],
      skills: [
        {
          id: 'media.music-playback',
          name: '点歌播放',
          summary: '搜索网易云歌曲并向当前房间发送音乐卡片。',
          toolNames: ['music.play_netease'],
          tags: ['music', 'media'],
          examples: ['点歌 晴天', '播放一首周杰伦'],
          metadata: {
            priority: 80,
            pluginName: 'builtin-music'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-music'
      }
    });
  }
};
