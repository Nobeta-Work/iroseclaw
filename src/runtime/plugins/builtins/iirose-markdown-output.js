/**
 * Builtin plugin: IIROSE markdown output
 */

const { createIiroseMarkdownOutputPlugin } = require('../../output/plugins/iirose-markdown-output');

module.exports = {
  name: 'builtin-iirose-markdown-output',
  apply(host, context) {
    host.registerOutputPlugin(createIiroseMarkdownOutputPlugin(
      context.config?.workflow?.markdownOutput || {}
    ));
  }
};
