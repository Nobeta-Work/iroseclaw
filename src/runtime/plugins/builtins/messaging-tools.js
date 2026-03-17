/**
 * Builtin plugin: messaging tools
 */

const { createReplyCurrentTool } = require('../../../tools/builtins/reply-current');
const { createMessageRouteTool } = require('../../../tools/builtins/message-route');

module.exports = {
  name: 'builtin-messaging-tools',
  apply(host, context) {
    context.registerToolPackage({
      name: 'builtin-messaging-tool-package',
      version: '0.2.0',
      tools: [
        createReplyCurrentTool({ outputRuntime: context.outputRuntime }),
        createMessageRouteTool({ outputRuntime: context.outputRuntime })
      ],
      metadata: {
        pluginName: 'builtin-messaging-tools'
      }
    });
  }
};
