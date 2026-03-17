/**
 * Builtin plugin: meme output
 */

const { createMemeOutputPlugin } = require('../../output/plugins/meme-output');
const memeService = require('../../../services/meme/search');

module.exports = {
  name: 'builtin-meme-output',
  apply(host, context) {
    host.registerService('meme.search', memeService);
    host.registerOutputPlugin(createMemeOutputPlugin(context.config.meme || {}));
  }
};
