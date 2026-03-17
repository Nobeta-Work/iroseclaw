/**
 * Music Skill
 * 点歌技能 - 使用 IIROSE 音乐卡片发送 (绕过 VIP)
 */

const { playSongInSession, searchNeteaseMusic, getDirectPlayUrl } = require('../../services/music/netease');

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
      const keyword = args?.query || args?.song || args?.keyword || '';
      return playSongInSession(session, keyword);
    }
  };
}

module.exports = { createMusicSkill, searchNeteaseMusic, getDirectPlayUrl };
