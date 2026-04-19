/**
 * Direct reply agent integration regression test
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  let messageHandler = null;
  const providerCalls = [];

  const ctx = {
    on(event, handler) {
      if (event === 'message') {
        messageHandler = handler;
      }
    },
    before() {},
    bots: []
  };

  index.apply(ctx, {
    bot: {
      uid: 'bot_uid',
      name: 'TestBot'
    },
    runtime: {
      mode: 'workflow'
    },
    workflow: {
      provider: {
        async complete(input = {}) {
          providerCalls.push(input);
          return {
            ok: true,
            provider: 'mock-direct-agent',
            text: '```python\nprint("hello")\n```'
          };
        }
      }
    },
    meme: {
      enabled: false,
      triggerProbability: 0,
      requestEmotionTag: false
    }
  });

  assert.equal(typeof messageHandler, 'function', 'message handler should be registered');

  const sent = [];
  await messageHandler({
    content: 'TestBot 输出一段python代码，使用markdown格式',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'msg-direct-agent',
    send: async (text) => {
      sent.push(text);
      return ['msg-out-1'];
    }
  });

  assert.equal(sent.length, 1, 'direct reply agent should send one reply');
  assert.equal(sent[0], '\\\\\\*\n```python\nprint("hello")\n```', 'direct reply agent should send markdown-wrapped code');
  assert.equal(providerCalls.length, 1, 'direct reply agent should bypass workflow planner and call provider once');
  assert.equal(providerCalls[0].json, false, 'direct reply agent should request plain text, not workflow JSON');

  console.log('✅ PASS: direct reply agent integration');
}

main().catch((error) => {
  console.error('❌ FAIL: direct reply agent integration');
  console.error(error.stack || error.message);
  process.exit(1);
});
