/**
 * Context Service
 * 封装消息上下文存储与构建，避免入口层直接操作存储细节
 */

const { MessageMemoryStore } = require('../../plugins/message-memory');

class ContextService {
  constructor(config = {}) {
    this.store = new MessageMemoryStore(config);
  }

  addUserMessage(input = {}) {
    return this.store.addUserMessage(input);
  }

  addBotMessage(input = {}) {
    return this.store.addBotMessage(input);
  }

  buildContext(input = {}) {
    return this.store.buildContext(input);
  }

  captureIncomingMessage(trigger = {}) {
    return this.addUserMessage({
      channelId: trigger.channelId,
      messageId: trigger.messageId,
      userId: trigger.userId,
      username: trigger.username,
      content: trigger.cleanedContent,
      rawContent: trigger.rawContent,
      isMentionBot: trigger.isMentioned,
      timestamp: trigger.timestamp
    });
  }

  buildConversationContextFromTrigger(trigger = {}, currentEventId = null) {
    return this.buildContext({
      channelId: trigger.channelId,
      currentEventId,
      userId: trigger.userId,
      username: trigger.username,
      currentContent: trigger.cleanedContent,
      currentRawContent: trigger.rawContent,
      timestamp: trigger.timestamp
    });
  }

  getMessagesInWindow(channelId, fromTs, toTs, options = {}) {
    return this.store.getMessagesInWindow({
      channelId,
      fromTs,
      toTs,
      roles: options.roles
    });
  }
}

module.exports = {
  ContextService
};
