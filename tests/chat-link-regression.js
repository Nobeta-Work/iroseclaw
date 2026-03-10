/**
 * Chat link regression test
 * 验证聊天链路能够正确进入 OpenClaw 适配器
 */

const assert = require('assert');
const { createMessageHandler } = require('../src/core/message-handler');

async function main() {
  let adapterCalled = 0;
  let lastProtocolRequest = null;

  const adapter = {
    async processMessage(request) {
      adapterCalled += 1;
      lastProtocolRequest = request;
      return {
        replyText: '来自openclaw'
      };
    }
  };

  const skillManager = {
    async execute() {
      throw new Error('chat regression test should not execute skill');
    }
  };

  const handleMessage = createMessageHandler(
    {
      bot: {
        uid: 'bot_uid_example',
        name: 'BotExample'
      },
      rateLimit: {
        perMinute: 60
      }
    },
    adapter,
    skillManager
  );

  const reply = await handleMessage({
    userId: 'u1',
    username: 'tester',
    content: '<at id="bot_uid_example" name="BotExample"/> 你好'
  });

  assert.equal(reply, '来自openclaw', 'should return adapter reply for <at id="..."/> format');
  assert.equal(adapterCalled, 1, 'adapter should be called exactly once');
  assert.equal(lastProtocolRequest?.message?.content, '你好', 'message content should be cleaned before adapter call');

  const replyWithPreclean = await handleMessage({
    userId: 'u2',
    username: 'tester2',
    content: '你好',
    cleanedContent: '你好',
    isBotMentioned: true
  });

  assert.equal(replyWithPreclean, '来自openclaw', 'should accept pre-cleaned session payload');
  assert.equal(adapterCalled, 2, 'adapter should be called for pre-cleaned payload');

  const replyNotMentioned = await handleMessage({
    userId: 'u3',
    username: 'tester3',
    content: '普通聊天消息'
  });

  assert.equal(replyNotMentioned, null, 'non-mentioned message should still be ignored');

  console.log('✅ PASS: chat link regression');
}

main().catch((error) => {
  console.error('❌ FAIL: chat link regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
