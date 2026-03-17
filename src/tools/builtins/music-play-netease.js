/**
 * music.play_netease tool
 * 提供面向 workflow 的网易云点歌能力
 */

const { createToolResult } = require('../../contracts/tool');
const { playSongInSessionDetailed } = require('../../services/music/netease');

function createMusicPlayNeteaseTool(options = {}) {
  const musicConfig = options.musicConfig || null;
  const playSongDetailed = typeof options.playSongDetailed === 'function'
    ? options.playSongDetailed
    : playSongInSessionDetailed;

  return {
    name: 'music.play_netease',
    description: 'Search and send a Netease music card to the current IIROSE room.',
    aliases: ['点歌', '音乐', '歌曲', '听歌', 'play', 'music', 'song'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        song: { type: 'string' },
        keyword: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object'
    },
    permission: ['music'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'medium',
    timeoutMs: 30000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['点歌'],
      helpVisible: true
    },
    async execute(context = {}, input = {}) {
      const session = context.session || null;
      const userId = context.userId || session?.userId || '';
      const username = context.username || session?.username || '';
      const query = typeof input.query === 'string'
        ? input.query
        : (typeof input.song === 'string' ? input.song : (typeof input.keyword === 'string' ? input.keyword : ''));

      try {
        const result = await playSongDetailed(session, query, musicConfig);
        const replyText = typeof result?.replyText === 'string' ? result.replyText : '';
        const statePatch = result?.ok
          ? {
              room: {
                currentSong: {
                  id: result.songId || '',
                  title: result.songName || '',
                  artist: result.artistName || '',
                  provider: result.provider || '',
                  query: result.query || query || '',
                  requestedBy: {
                    userId,
                    username
                  }
                }
              },
              user: userId
                ? {
                    lastPlayedSong: {
                      id: result.songId || '',
                      title: result.songName || '',
                      artist: result.artistName || '',
                      query: result.query || query || ''
                    }
                  }
                : {}
            }
          : {};

        return createToolResult({
          ok: result?.ok !== false,
          name: 'music.play_netease',
          result: replyText || null,
          data: result?.ok === false ? null : {
            songId: result.songId || '',
            songName: result.songName || '',
            artistName: result.artistName || '',
            provider: result.provider || '',
            playUrlHost: result.playUrlHost || '',
            usedMusicCard: result.usedMusicCard === true
          },
          outputs: replyText
            ? [
                {
                  kind: 'reply.current',
                  content: {
                    text: replyText,
                    useMemePipeline: false
                  }
                }
              ]
            : [],
          statePatch,
          summary: replyText ? replyText.slice(0, 120) : `music:${result.songName || query || ''}`,
          error: result?.ok === false ? (result.error || replyText || 'music tool failed') : ''
        });
      } catch (error) {
        return createToolResult({
          ok: false,
          name: 'music.play_netease',
          error: error.message
        });
      }
    }
  };
}

module.exports = {
  createMusicPlayNeteaseTool
};
