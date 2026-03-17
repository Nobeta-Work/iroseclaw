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
      metadata: {
        pluginName: 'builtin-music'
      }
    });
  }
};
