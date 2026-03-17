/**
 * Workflow default LLM mode regression test
 * 验证 workflow 模式在未显式指定 planner 时默认走 llm-default。
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  let messageHandler = null;

  const ctx = {
    on(event, handler) {
      if (event === 'message') {
        messageHandler = handler;
      }
    },
    before() {},
    bots: []
  };

  const providerCalls = [];
  const app = index.apply(ctx, {
    bot: {
      uid: 'bot_uid',
      name: 'TestBot'
    },
    runtime: {
      mode: 'workflow'
    },
    workflow: {
      providerFactory() {
        return {
          label: 'mock-workflow-provider',
          async complete(input) {
            providerCalls.push(input);
            return {
              ok: true,
              provider: 'mock-workflow-provider',
              text: '{"status":"final","finalOutput":{"mode":"reply","text":"来自默认 llm planner"}}'
            };
          }
        };
      }
    },
    meme: {
      enabled: false,
      triggerProbability: 0,
      requestEmotionTag: false
    }
  });

  assert.equal(app.workflowPlanner?.label, 'llm-default', 'workflow mode should default to llm-default planner');
  assert.equal(app.adapter, null, 'workflow default llm mode should not eagerly initialize legacy adapter');
  assert.equal(app.skillManager, null, 'workflow default llm mode should not eagerly initialize legacy skill manager');
  assert.equal(typeof messageHandler, 'function', 'message handler should be registered');

  const sent = [];
  await messageHandler({
    content: 'TestBot 今天天气如何',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'msg-llm-default',
    send: async (text) => {
      sent.push(text);
      return ['msg-out-1'];
    }
  });

  assert.equal(providerCalls.length >= 1, true, 'default llm planner should call configured provider');
  assert.equal(sent.length, 1, 'workflow chat should send exactly one final reply');
  assert.equal(sent[0], '来自默认 llm planner', 'workflow chat should use llm-default planner output');
  console.log('✅ PASS: workflow default llm mode regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow default llm mode regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
