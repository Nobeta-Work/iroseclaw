/**
 * Workflow provider silent failure regression test
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  let messageHandler = null;
  let providerCalls = 0;

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
      maxProviderRetries: 2,
      provider: {
        async complete() {
          providerCalls += 1;
          return {
            ok: false,
            provider: 'mock-failure',
            error: 'timeout'
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
    content: 'TestBot 今天天气怎么样',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'msg-provider-fail',
    platform: 'iirose',
    send: async (text) => {
      sent.push(text);
      return ['msg-out-1'];
    }
  });

  assert.equal(providerCalls, 3, 'workflow planner should retry provider two extra times');
  assert.equal(sent.length, 0, 'provider failure should stay silent instead of sending fallback');
  console.log('✅ PASS: workflow provider silent failure regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow provider silent failure regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
