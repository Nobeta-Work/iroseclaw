/**
 * Named provider default selection regression test
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  let messageHandler = null;
  const previousFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '{"status":"final","finalOutput":{"mode":"reply","text":"来自 named provider"}}'
              }
            }
          ]
        });
      }
    };
  };

  try {
    const ctx = {
      on(event, handler) {
        if (event === 'message') {
          messageHandler = handler;
        }
      },
      before() {},
      bots: []
    };

    const app = index.apply(ctx, {
      bot: {
        uid: 'bot_uid',
        name: 'TestBot'
      },
      runtime: {
        mode: 'workflow'
      },
      providers: {
        default: 'analysis-http',
        named: {
          'analysis-http': {
            type: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            model: 'gpt-test',
            enabled: true
          }
        }
      },
      meme: {
        enabled: false,
        triggerProbability: 0,
        requestEmotionTag: false
      }
    });

    assert.ok(app.modelProvider instanceof index.OpenAICompatibleProvider, 'workflow should resolve named default provider to stateless HTTP provider');
    assert.equal(app.adapter, null, 'workflow default named provider path should not eagerly initialize legacy adapter');
    assert.equal(typeof messageHandler, 'function', 'message handler should be registered');

    const sent = [];
    await messageHandler({
      content: 'TestBot 今天天气如何',
      userId: 'u1',
      username: 'Tester',
      channelId: 'room-1',
      messageId: 'msg-named-provider-1',
      send: async (text) => {
        sent.push(text);
        return ['msg-out-1'];
      }
    });

    assert.equal(fetchCalls.length >= 1, true, 'named provider should issue HTTP request');
    assert.equal(sent[0], '来自 named provider', 'workflow should use named provider output');
  } finally {
    global.fetch = previousFetch;
  }

  console.log('✅ PASS: named provider default selection regression');
}

main().catch((error) => {
  console.error('❌ FAIL: named provider default selection regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
