/**
 * Builtin plugin: chat-like output
 */

const { createChatLikeOutputPlugin } = require('../../output/plugins/chat-like-output');

module.exports = {
  name: 'builtin-chat-like-output',
  apply(host, context) {
    host.registerOutputPlugin(createChatLikeOutputPlugin(
      context.config?.workflow?.chatOutput || {}
    ));
  }
};
