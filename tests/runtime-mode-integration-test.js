/**
 * Runtime mode integration test
 * 验证 workflow mode 下入口会走新 runtime 链路处理直接工具请求
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

  index.apply(ctx, {
    bot: {
      uid: 'bot_uid',
      name: 'TestBot'
    },
    runtime: {
      mode: 'workflow'
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
    content: 'TestBot 帮助',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'msg-1',
    send: async (text) => {
      sent.push(text);
      return ['msg-out-1'];
    }
  });

  assert.equal(sent.length, 1, 'workflow mode should send one help reply');
  assert.ok(sent[0].startsWith('\\\\\\*\n'), 'workflow mode help should prepend markdown-render prefix line');
  assert.equal(sent[0].includes('暂无可用技能'), false, 'workflow mode help should no longer claim there are no skills when runtime tools exist');
  assert.ok(sent[0].includes('21点开局'), 'workflow mode help should expose Blackjack in compact help text');
  assert.ok(sent[0].includes('管理/运维类内部操作已隐藏'), 'workflow mode help should explicitly hide internal operation tools');
  console.log('✅ PASS: runtime mode integration');
}

main().catch((error) => {
  console.error('❌ FAIL: runtime mode integration');
  console.error(error.stack || error.message);
  process.exit(1);
});
