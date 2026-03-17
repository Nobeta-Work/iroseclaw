/**
 * Context service regression test
 */

const assert = require('assert');
const { ContextService } = require('../src/runtime/context/service');

async function main() {
  const contextService = new ContextService({
    persist: false,
    maxEventsPerChannel: 20,
    recentMessageCount: 4,
    maxMessageChars: 100
  });

  const first = contextService.captureIncomingMessage({
    channelId: 'room-ctx',
    messageId: 'm1',
    userId: 'u1',
    username: 'Alice',
    rawContent: '@Bot hi',
    cleanedContent: 'hi',
    isMentioned: true,
    timestamp: 1000
  });

  contextService.addBotMessage({
    channelId: 'room-ctx',
    messageId: 'm2',
    userId: 'bot',
    username: 'Bot',
    content: 'hello',
    timestamp: 1001
  });

  const second = contextService.captureIncomingMessage({
    channelId: 'room-ctx',
    messageId: 'm3',
    userId: 'u2',
    username: 'Bob',
    rawContent: '@Bot 再问一次',
    cleanedContent: '再问一次',
    isMentioned: true,
    timestamp: 1002
  });

  const context = contextService.buildConversationContextFromTrigger({
    channelId: 'room-ctx',
    userId: 'u2',
    username: 'Bob',
    cleanedContent: '再问一次',
    rawContent: '@Bot 再问一次',
    timestamp: 1002
  }, second.id);

  assert.ok(first && second, 'incoming messages should be stored');
  assert.equal(context.currentMessage.content, '再问一次', 'current message should be preserved');
  assert.equal(context.currentMessage.rawContent, '@Bot 再问一次', 'current raw message should be preserved');
  assert.equal(context.recentMessages.length, 3, 'recent messages should include stored conversation');
  assert.equal(context.channelRecentMessages.length, 3, 'channel recent messages should be tracked');
  assert.equal(context.anchorCount, 2, 'anchor count should reflect mention messages');

  console.log('✅ PASS: context service regression');
}

main().catch((error) => {
  console.error('❌ FAIL: context service regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
