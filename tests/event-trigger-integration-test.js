/**
 * Event trigger integration test
 * 验证启用 eventTriggersEnabled 后，平台事件会进入 workflow trigger 链路
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  const seenTriggers = [];
  const handlers = new Map();
  const ctx = {
    on(event, handler) {
      handlers.set(event, handler);
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
      mode: 'workflow',
      eventTriggersEnabled: true
    },
    workflow: {
      plannerFactory() {
        return {
          label: 'test-event-planner',
          async decideNextStep(input) {
            seenTriggers.push(input.trigger?.kind || '');
            return {
              status: 'final',
              finalOutput: {
                mode: 'none',
                text: ''
              }
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

  assert.equal(app.adapter, null, 'custom plannerFactory path should not eagerly initialize legacy adapter');

  const eventHandler = handlers.get('iirose/payment');
  assert.equal(typeof eventHandler, 'function', 'payment event handler should be registered in workflow mode');

  await eventHandler({
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    send: async () => ['out-1']
  }, {
    uid: 'u1',
    username: 'Tester'
  });

  assert.equal(seenTriggers.includes('iirose.payment'), true, 'event trigger should enter workflow planner');
  console.log('✅ PASS: event trigger integration');
}

main().catch((error) => {
  console.error('❌ FAIL: event trigger integration');
  console.error(error.stack || error.message);
  process.exit(1);
});
