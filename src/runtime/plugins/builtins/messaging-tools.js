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
      skills: [
        {
          id: 'communication.public-reply',
          name: '当前会话回复',
          summary: '向当前会话发送回复。',
          toolNames: ['reply.current'],
          tags: ['communication', 'reply'],
          metadata: {
            priority: 70,
            pluginName: 'builtin-messaging-tools'
          }
        },
        {
          id: 'communication.room-routing',
          name: '消息路由',
          summary: '向其他房间或私聊目标路由消息。',
          toolNames: ['message.route'],
          tags: ['communication', 'routing'],
          adminOnly: true,
          metadata: {
            priority: 40,
            pluginName: 'builtin-messaging-tools'
          }
        }
      ],
      metadata: {
        pluginName: 'builtin-messaging-tools'
      }
    });
  }
};
