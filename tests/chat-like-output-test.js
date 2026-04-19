/**
 * Chat-like output regression test
 */

const assert = require('assert');
const index = require('../src/index');
const { ensureLeadingRoseMentionSpace } = require('../src/utils/iirose-rose-mention');
const {
  splitChatLikeText
} = require('../src/runtime/output/plugins/chat-like-output');

async function main() {
  assert.deepEqual(splitChatLikeText('你好 / 有什么事嘛'), ['你好', '有什么事嘛'], 'slash-separated chat should split');
  assert.deepEqual(
    splitChatLikeText('https://example.com/a/b'),
    ['https://example.com/a/b'],
    'url should not be split by chat output helper'
  );
  assert.deepEqual(
    splitChatLikeText('状态报告\n时间: 2026/04/13'),
    ['状态报告\n时间: 2026/04/13'],
    'multiline status text should stay intact in helper output'
  );
  assert.deepEqual(
    splitChatLikeText('好的主人～\n/这是第一段话\n/这是第二段话'),
    ['好的主人～', '这是第一段话', '这是第二段话'],
    'slash-prefixed multiline chat should split into multiple messages'
  );
  assert.equal(
    ensureLeadingRoseMentionSpace('[*十字*] 主人让我叫您呢～有什么吩咐吗？'),
    ' [*十字*] 主人让我叫您呢～有什么吩咐吗？',
    'rose mention at segment start should regain required leading space'
  );
  assert.equal(
    ensureLeadingRoseMentionSpace('晚安 [*小柑橘*]'),
    '晚安 [*小柑橘*] ',
    'rose mention at segment end should retain required trailing space'
  );

  const ctx = {
    on() {},
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
    workflow: {
      chatOutput: {
        enabled: true,
        splitDelimiter: '/',
        typingDelayPerCharMs: 5,
        maxTypingDelayMs: 100
      }
    },
    meme: {
      enabled: false,
      triggerProbability: 0,
      requestEmotionTag: false
    }
  });

  const sent = [];
  const start = Date.now();
  await app.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text: '你好 / 有什么事嘛'
    }
  }, {
    session: {
      platform: 'iirose',
      channelId: 'room-1',
      send: async (text) => {
        sent.push({
          text,
          at: Date.now() - start
        });
        return ['msg-out'];
      }
    },
    ctx
  });

  assert.deepEqual(sent.map(item => item.text), ['你好', '有什么事嘛'], 'output runtime should send split chat segments');
  assert.equal(sent[0].at >= 10, true, 'first segment should respect typing delay');
  assert.equal(sent[1].at > sent[0].at, true, 'second segment should be sent after the first');

  const sentMultiline = [];
  await app.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text: '好的主人～\n/这是第一段话\n/这是第二段话'
    }
  }, {
    session: {
      platform: 'iirose',
      channelId: 'room-1',
      send: async (text) => {
        sentMultiline.push(text);
        return ['msg-out'];
      }
    },
    ctx
  });
  assert.deepEqual(
    sentMultiline,
    ['好的主人～', '这是第一段话', '这是第二段话'],
    'output runtime should split slash-prefixed multiline chat'
  );

  const sentRoseMention = [];
  await app.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text: '[*十字*] 主人让我叫您呢～有什么吩咐吗？'
    }
  }, {
    session: {
      platform: 'iirose',
      channelId: 'room-1',
      send: async (text) => {
        sentRoseMention.push(text);
        return ['msg-out'];
      }
    },
    ctx
  });
  assert.deepEqual(
    sentRoseMention,
    [' [*十字*] 主人让我叫您呢～有什么吩咐吗？'],
    'output runtime should preserve required leading space for rose mention syntax'
  );

  const sentRoseMentionTail = [];
  await app.outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text: '晚安 [*小柑橘*]'
    }
  }, {
    session: {
      platform: 'iirose',
      channelId: 'room-1',
      send: async (text) => {
        sentRoseMentionTail.push(text);
        return ['msg-out'];
      }
    },
    ctx
  });
  assert.deepEqual(
    sentRoseMentionTail,
    ['晚安 [*小柑橘*] '],
    'output runtime should preserve required trailing space for rose mention syntax'
  );
  console.log('✅ PASS: chat-like output regression');
}

main().catch((error) => {
  console.error('❌ FAIL: chat-like output regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
