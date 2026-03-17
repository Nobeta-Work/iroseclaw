/**
 * Conversation context regression tests
 */

const assert = require('assert');
const { ConversationStore } = require('../src/core/conversation-store');
const { createMessageHandler } = require('../src/core/message-handler');
const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');
const { MessageMemoryStore } = require('../src/plugins/message-memory');
const { resolveReplyOutput } = require('../src/utils/meme-format');

async function testConversationStore() {
  const store = new ConversationStore({
    maxEventsPerChannel: 50,
    anchorLookBehind: 1,
    anchorLookAhead: 2,
    detailedAnchorCount: 2,
    summaryAnchorCount: 3,
    maxMessageChars: 100,
    maxSummaryChars: 100
  });

  const base = 1700000000000;
  store.addUserMessage({ channelId: 'room-1', userId: 'u1', username: 'Alice', content: '普通前文', timestamp: base });
  store.addUserMessage({ channelId: 'room-1', userId: 'u2', username: 'Bob', content: '第一个问题', isMentionBot: true, timestamp: base + 1 });
  store.addBotMessage({ channelId: 'room-1', userId: 'bot', username: 'Bot', content: '第一个回答', timestamp: base + 2 });
  store.addUserMessage({ channelId: 'room-1', userId: 'u3', username: 'Carol', content: '插话', timestamp: base + 3 });
  store.addUserMessage({ channelId: 'room-1', userId: 'u1', username: 'Alice', content: '第二个问题', isMentionBot: true, timestamp: base + 4 });
  store.addBotMessage({ channelId: 'room-1', userId: 'bot', username: 'Bot', content: '第二个回答', timestamp: base + 5 });
  store.addUserMessage({ channelId: 'room-1', userId: 'u4', username: 'Dave', content: '围观', timestamp: base + 6 });
  const current = store.addUserMessage({
    channelId: 'room-1',
    userId: 'u5',
    username: 'Eve',
    content: '当前问题',
    isMentionBot: true,
    timestamp: base + 7
  });

  const context = store.buildContext({
    channelId: 'room-1',
    currentEventId: current.id,
    userId: 'u5',
    username: 'Eve',
    currentContent: '当前问题',
    timestamp: base + 7
  });

  assert.equal(context.triggerUser.id, 'u5', 'trigger user id should be preserved');
  assert.equal(context.currentMessage.content, '当前问题', 'current message should come from current anchor');
  assert.equal(context.anchorCount, 3, 'three mention anchors should be tracked');
  assert.equal(context.historySummary.length, 1, 'older anchor should be summarized');
  assert.ok(context.historySummary[0].includes('uid=u2'), 'summary should include historical uid');
  assert.ok(context.recentMessages.some(item => item.content === '第二个问题'), 'recent messages should include latest historical anchor');
  assert.ok(context.recentMessages.some(item => item.content === '第二个回答'), 'recent messages should include bot reply near anchor');
  assert.ok(context.recentMessages.some(item => item.content === '当前问题'), 'recent messages should include current anchor');
}

async function testConversationStoreDefaultWindow() {
  const store = new ConversationStore({
    maxEventsPerChannel: 80,
    maxMessageChars: 100,
    maxSummaryChars: 100
  });

  const base = 1700001000000;
  store.addUserMessage({
    channelId: 'room-window',
    userId: 'u0',
    username: 'AnchorUser',
    content: '历史锚点',
    isMentionBot: true,
    timestamp: base
  });

  for (let i = 1; i <= 12; i++) {
    store.addUserMessage({
      channelId: 'room-window',
      userId: `h${i}`,
      username: `History${i}`,
      content: `hist-follow-${i}`,
      timestamp: base + i
    });
  }

  for (let i = 1; i <= 12; i++) {
    store.addUserMessage({
      channelId: 'room-window',
      userId: `p${i}`,
      username: `Prev${i}`,
      content: `pre-${i}`,
      timestamp: base + 20 + i
    });
  }

  const current = store.addUserMessage({
    channelId: 'room-window',
    userId: 'u-current',
    username: 'CurrentUser',
    content: '当前问题',
    isMentionBot: true,
    timestamp: base + 40
  });

  const context = store.buildContext({
    channelId: 'room-window',
    currentEventId: current.id,
    userId: 'u-current',
    username: 'CurrentUser',
    currentContent: '当前问题',
    timestamp: base + 40
  });

  const contents = context.recentMessages.map(item => item.content);
  assert.ok(contents.includes('hist-follow-10'), 'default lookahead should include 10 messages after historical anchor');
  assert.ok(!contents.includes('hist-follow-11'), 'default lookahead should stop after 10 messages');
  assert.ok(contents.includes('pre-3'), 'default lookbehind should include 10 messages before current anchor');
  assert.ok(!contents.includes('pre-2'), 'default lookbehind should trim messages outside the last 10');
  assert.ok(contents.includes('当前问题'), 'current anchor should stay in recent messages');
}

async function testMessageHandlerContextInjection() {
  let capturedRequest = null;
  const adapter = {
    async processMessage(request) {
      capturedRequest = request;
      return { replyText: 'ok' };
    }
  };

  const skillManager = {
    async execute() {
      throw new Error('context injection test should not execute skills');
    }
  };

  const handleMessage = createMessageHandler(
    {
      bot: { uid: 'bot_uid_example', name: 'BotExample' },
      rateLimit: { perMinute: 60 }
    },
    adapter,
    skillManager,
    {
      getConversationContext() {
        return {
          triggerUser: { id: 'u1', name: 'Tester' },
          currentMessage: { userId: 'u1', username: 'Tester', content: '你好', timestamp: 12345 },
          recentMessages: [
            { role: 'user', userId: 'u2', username: 'Other', content: '前文', timestamp: 12000, isMentionBot: false }
          ],
          historySummary: ['12:00:00 Other(uid=u2) @bot: 老问题 | bot: 老回答'],
          anchorCount: 2
        };
      }
    }
  );

  const reply = await handleMessage({
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-ctx',
    content: '<at id="bot_uid_example" name="BotExample"/> 你好'
  });

  assert.equal(reply, 'ok', 'handler should still return adapter reply');
  assert.equal(capturedRequest?.session?.userId, 'u1', 'request should include user id');
  assert.equal(capturedRequest?.session?.username, 'Tester', 'request should include username');
  assert.equal(capturedRequest?.session?.channelId, 'room-ctx', 'request should include channel id');
  assert.equal(capturedRequest?.context?.triggerUser?.id, 'u1', 'context should include trigger uid');
  assert.equal(capturedRequest?.context?.recentMessages?.length, 1, 'context should include recent messages');
  assert.equal(capturedRequest?.context?.historySummary?.length, 1, 'context should include history summary');
}

async function testMessageHandlerSourceSessionFallback() {
  let capturedRequest = null;
  const adapter = {
    async processMessage(request) {
      capturedRequest = request;
      return { replyText: 'ok' };
    }
  };

  const skillManager = {
    async execute() {
      throw new Error('sourceSession fallback test should not execute skills');
    }
  };

  const handleMessage = createMessageHandler(
    {
      bot: { uid: 'bot_uid_example', name: 'BotExample' },
      rateLimit: { perMinute: 60 }
    },
    adapter,
    skillManager
  );

  const sourceSession = {};
  Object.defineProperties(sourceSession, {
    userId: {
      enumerable: false,
      get() {
        return 'getter-u1';
      }
    },
    username: {
      enumerable: false,
      get() {
        return 'GetterUser';
      }
    },
    channelId: {
      enumerable: false,
      get() {
        return 'room-getter';
      }
    },
    messageId: {
      enumerable: false,
      get() {
        return 'msg-getter';
      }
    }
  });

  const reply = await handleMessage({
    ...sourceSession,
    sourceSession,
    content: '你好',
    rawContent: '<at id="bot_uid_example" name="BotExample"/> 你好',
    cleanedContent: '你好',
    isBotMentioned: true
  });

  assert.equal(reply, 'ok', 'handler should still return adapter reply when metadata lives on source session');
  assert.equal(capturedRequest?.session?.userId, 'getter-u1', 'request should recover uid from source session');
  assert.equal(capturedRequest?.session?.username, 'GetterUser', 'request should recover username from source session');
  assert.equal(capturedRequest?.session?.channelId, 'room-getter', 'request should recover channel id from source session');
  assert.equal(capturedRequest?.session?.messageId, 'msg-getter', 'request should recover message id from source session');
}

async function testAdapterPromptBuild() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    useNativeSessionContext: false,
    fallbackResponses: ['fallback']
  });

  const prompt = adapter._buildContextPrompt({
    session: {
      userId: 'u1',
      username: 'Tester',
      channelId: 'room-ctx'
    },
    message: {
      content: '现在回复我'
    },
    context: {
      triggerUser: {
        id: 'u1',
        name: 'Tester'
      },
      currentMessage: {
        userId: 'u1',
        username: 'Tester',
        content: '现在回复我',
        rawContent: '<at id="bot_uid_example" name="BotExample"/> 现在回复我'
      },
      recentMessages: [
        { role: 'user', userId: 'u2', username: 'Other', content: '前文消息', rawContent: '前文消息', isMentionBot: false }
      ],
      channelRecentMessages: [
        { role: 'user', userId: 'u3', username: 'Watcher', content: '旁观消息', rawContent: '<sharp id="68807acf5884c"/>', isMentionBot: false }
      ],
      historySummary: ['12:00:00 Other(uid=u2) @bot: 旧提问 | bot: 旧回答']
    }
  });

  assert.ok(prompt.includes('uid=u1'), 'prompt should include trigger uid');
  assert.ok(prompt.includes('Other(uid=u2)'), 'prompt should include participant uid');
  assert.ok(prompt.includes('旧提问'), 'prompt should include summary text');
  assert.ok(prompt.includes('当前需要回复的消息'), 'prompt should include current message marker');
  assert.ok(prompt.includes('最近与 bot 相关消息'), 'prompt should include bot-related context section');
  assert.ok(prompt.includes('当前频道最近消息'), 'prompt should include channel context section');
  assert.ok(prompt.includes('raw=<at id="bot_uid_example" name="BotExample"/> 现在回复我'), 'prompt should preserve raw current message when it differs from cleaned content');
}

async function testAdapterJsonReplyExtraction() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['fallback']
  });

  const nestedResult = JSON.stringify({
    runId: 'abc',
    status: 'ok',
    result: {
      payloads: [
        { text: '嵌套结果回复' }
      ]
    }
  });
  const topLevelPayloads = JSON.stringify({
    payloads: [
      { text: '顶层回复' }
    ]
  });

  assert.equal(
    adapter._extractReplyTextFromJson(nestedResult),
    '嵌套结果回复',
    'adapter should parse current OpenClaw result.payloads JSON shape'
  );
  assert.equal(
    adapter._extractReplyTextFromJson(topLevelPayloads),
    '顶层回复',
    'adapter should parse top-level payloads JSON shape'
  );

  const noisyOutput = [
    '[plugins] feishu_bitable: Registered bitable tools',
    'Config warnings:\\n- plugins.entries.feishu: duplicate',
    topLevelPayloads
  ].join('\n');

  assert.equal(
    adapter._extractReplyTextFromJson(noisyOutput),
    '顶层回复',
    'adapter should still parse JSON reply when stdout contains plugin logs before payload'
  );
}

async function testAdapterCommandArgsIsolation() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['fallback']
  });

  const request = {
    requestId: 'req_123',
    session: {
      channelId: 'room-1',
      userId: 'user-1',
      messageId: 'msg-1'
    }
  };
  const followupRequest = {
    requestId: 'req_124',
    session: {
      channelId: 'room-1',
      userId: 'user-1',
      messageId: 'msg-2'
    }
  };

  const jsonArgs = adapter._buildCommandArgs(request, '你好');
  const followupArgs = adapter._buildCommandArgs(followupRequest, '继续');
  const jsonSessionIndex = jsonArgs.indexOf('--session-id');
  const followupSessionIndex = followupArgs.indexOf('--session-id');

  assert.ok(jsonArgs.includes('--local'), 'adapter should use local execution by default to avoid gateway session contamination');
  assert.ok(jsonSessionIndex >= 0, 'adapter should pass a session id');
  assert.ok(followupSessionIndex >= 0, 'follow-up request should also pass a session id');
  assert.notEqual(
    jsonArgs[jsonSessionIndex + 1],
    followupArgs[followupSessionIndex + 1],
    'requests should use isolated OpenClaw session ids when native session context is disabled'
  );
}

async function testResolveReplyOutput() {
  const tagOnly = resolveReplyOutput('[[EMO:调皮]]');
  const taggedText = resolveReplyOutput('看得到呀 [[EMO:开心]]');

  assert.equal(tagOnly.text, '', 'tag-only reply should not be treated as user-visible text');
  assert.equal(tagOnly.emotion, '调皮', 'tag-only reply should still preserve emotion');
  assert.equal(taggedText.text, '看得到呀', 'tagged reply should strip emotion tag from visible text');
  assert.equal(taggedText.emotion, '开心', 'tagged reply should keep emotion tag');
}

async function testAdapterPlainExtractionSkipsPluginLogs() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['fallback']
  });

  const onlyLogs = [
    '[plugins] feishu_bitable: Registered bitable tools',
    '[diagnostic] lane task error: timeout',
    'Config warnings:',
    '- plugins.entries.feishu: duplicate'
  ].join('\n');

  assert.equal(
    adapter._extractReplyTextFromPlain(onlyLogs),
    '',
    'plain extractor should not treat plugin logs as chat reply text'
  );
}

async function testAdapterNativeContextPrompt() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    useNativeSessionContext: true,
    fallbackResponses: ['fallback']
  });

  const prompt = adapter._buildContextPrompt({
    session: {
      userId: 'u1',
      username: 'Tester',
      channelId: 'room-native'
    },
    message: {
      content: '我刚才在聊什么游戏'
    },
    context: {
      triggerUser: {
        id: 'u1',
        name: 'Tester'
      },
      currentMessage: {
        userId: 'u1',
        username: 'Tester',
        content: '我刚才在聊什么游戏'
      },
      recentMessages: [
        { role: 'user', userId: 'u2', username: 'Other', content: '不应被拼进 prompt', isMentionBot: false }
      ],
      historySummary: ['不应被拼进 prompt']
    }
  });

  assert.ok(prompt.includes('同一 session 的历史消息由系统自动保留'), 'native context prompt should mention OpenClaw session memory');
  assert.ok(prompt.includes('当前需要回复的消息'), 'native context prompt should keep current message');
  assert.ok(!prompt.includes('最近相关消息'), 'native context prompt should not inline recentMessages');
  assert.ok(!prompt.includes('更早历史摘要'), 'native context prompt should not inline history summary');

  const request = {
    requestId: 'req_native',
    session: {
      channelId: 'room-native',
      userId: 'u1',
      messageId: 'm1'
    }
  };
  const followupRequest = {
    requestId: 'req_native_followup',
    session: {
      channelId: 'room-native',
      userId: 'u1',
      messageId: 'm2'
    }
  };
  const firstArgs = adapter._buildCommandArgs(request, '你好');
  const secondArgs = adapter._buildCommandArgs(followupRequest, '继续');
  const firstSessionIndex = firstArgs.indexOf('--session-id');
  const secondSessionIndex = secondArgs.indexOf('--session-id');

  assert.ok(firstSessionIndex >= 0 && secondSessionIndex >= 0, 'native session context should still pass session ids');
  assert.equal(
    firstArgs[firstSessionIndex + 1],
    secondArgs[secondSessionIndex + 1],
    'native session context should reuse a stable OpenClaw session id'
  );
}

async function testMessageMemoryStoreRecentContext() {
  const store = new MessageMemoryStore({
    persist: false,
    maxEventsPerChannel: 20,
    recentMessageCount: 4,
    channelRecentMessageCount: 6,
    anchorLookBehind: 1,
    anchorLookAhead: 2,
    detailedAnchorCount: 2,
    summaryAnchorCount: 2,
    maxMessageChars: 100
  });

  const base = 1700002000000;
  store.addUserMessage({ channelId: 'room-memory', userId: 'u1', username: 'Alice', content: '第一句', timestamp: base });
  store.addUserMessage({ channelId: 'room-memory', userId: 'u2', username: 'Bob', content: '第二句', timestamp: base + 1 });
  store.addBotMessage({ channelId: 'room-memory', userId: 'bot', username: 'Bot', content: '第三句', timestamp: base + 2 });
  const current = store.addUserMessage({
    channelId: 'room-memory',
    userId: 'u3',
    username: 'Carol',
    content: '第四句',
    rawContent: '@Bot 第四句',
    isMentionBot: true,
    timestamp: base + 3
  });

  const context = store.buildContext({
    channelId: 'room-memory',
    currentEventId: current.id,
    userId: 'u3',
    username: 'Carol',
    currentContent: '第四句',
    currentRawContent: '@Bot 第四句',
    timestamp: base + 3
  });

  assert.equal(context.recentMessages.length, 4, 'memory store should inject recent linear messages');
  assert.equal(context.currentMessage.content, '第四句', 'memory store should preserve current message');
  assert.equal(context.currentMessage.rawContent, '@Bot 第四句', 'memory store should preserve current raw message');
  assert.equal(context.recentMessages[0].content, '第一句', 'memory store should keep chronological order');
  assert.equal(context.recentMessages[3].content, '第四句', 'memory store should include current mention message');
  assert.equal(context.channelRecentMessages.length, 4, 'memory store should also expose channel recent messages');
}

async function testMessageMemoryStoreSecondEpochWindowCompatibility() {
  const store = new MessageMemoryStore({
    persist: false,
    maxEventsPerChannel: 20,
    recentMessageCount: 4,
    maxMessageChars: 100
  });

  const baseSec = 1773495200;
  store.addUserMessage({ channelId: 'room-window', userId: 'u1', username: 'Alice', content: '前文', timestamp: baseSec });
  store.addUserMessage({ channelId: 'room-window', userId: 'u2', username: 'Bob', content: '后文', timestamp: baseSec + 30 });

  const rows = store.getMessagesInWindow({
    channelId: 'room-window',
    fromTs: (baseSec - 10) * 1000,
    toTs: (baseSec + 60) * 1000
  });

  assert.equal(rows.length, 2, 'window query should match second-based stored events against ms windows');
  assert.equal(rows[0].timestamp, baseSec * 1000, 'returned timestamps should be normalized to ms');
}

async function testMessageMemoryStoreAnchorSummaryAndChannelContext() {
  const store = new MessageMemoryStore({
    persist: false,
    maxEventsPerChannel: 30,
    recentMessageCount: 6,
    channelRecentMessageCount: 8,
    anchorLookBehind: 1,
    anchorLookAhead: 2,
    detailedAnchorCount: 2,
    summaryAnchorCount: 2,
    maxMessageChars: 100,
    maxSummaryChars: 100
  });

  const base = 1700003000000;
  store.addUserMessage({ channelId: 'room-anchor', userId: 'u1', username: 'Alice', content: '普通前文', timestamp: base });
  store.addUserMessage({ channelId: 'room-anchor', userId: 'u2', username: 'Bob', content: '第一个问题', rawContent: '@Bot 第一个问题', isMentionBot: true, timestamp: base + 1 });
  store.addBotMessage({ channelId: 'room-anchor', userId: 'bot', username: 'Bot', content: '第一个回答', timestamp: base + 2 });
  store.addUserMessage({ channelId: 'room-anchor', userId: 'u3', username: 'Carol', content: '插话', timestamp: base + 3 });
  store.addUserMessage({ channelId: 'room-anchor', userId: 'u1', username: 'Alice', content: '第二个问题', rawContent: '@Bot 第二个问题', isMentionBot: true, timestamp: base + 4 });
  store.addBotMessage({ channelId: 'room-anchor', userId: 'bot', username: 'Bot', content: '第二个回答', timestamp: base + 5 });
  store.addUserMessage({ channelId: 'room-anchor', userId: 'u4', username: 'Dave', content: '围观', timestamp: base + 6 });
  const current = store.addUserMessage({
    channelId: 'room-anchor',
    userId: 'u5',
    username: 'Eve',
    content: '当前问题',
    rawContent: '@Bot 当前问题',
    isMentionBot: true,
    timestamp: base + 7
  });

  const context = store.buildContext({
    channelId: 'room-anchor',
    currentEventId: current.id,
    userId: 'u5',
    username: 'Eve',
    currentContent: '当前问题',
    currentRawContent: '@Bot 当前问题',
    timestamp: base + 7
  });

  assert.equal(context.anchorCount, 3, 'memory store should count mention anchors across the channel');
  assert.equal(context.historySummary.length, 1, 'older anchors should be summarized');
  assert.ok(context.historySummary[0].includes('uid=u2'), 'summary should preserve historical uid');
  assert.ok(context.recentMessages.some(item => item.content === '第二个回答'), 'recent relevant context should include bot replies near latest anchors');
  assert.ok(context.channelRecentMessages.length >= context.recentMessages.length, 'channel context should be tracked separately from bot-related context');
}

async function main() {
  await testConversationStore();
  await testConversationStoreDefaultWindow();
  await testMessageMemoryStoreRecentContext();
  await testMessageMemoryStoreSecondEpochWindowCompatibility();
  await testMessageMemoryStoreAnchorSummaryAndChannelContext();
  await testMessageHandlerContextInjection();
  await testMessageHandlerSourceSessionFallback();
  await testAdapterPromptBuild();
  await testAdapterJsonReplyExtraction();
  await testAdapterCommandArgsIsolation();
  await testResolveReplyOutput();
  await testAdapterPlainExtractionSkipsPluginLogs();
  await testAdapterNativeContextPrompt();
  console.log('✅ PASS: conversation context regression');
}

main().catch((error) => {
  console.error('❌ FAIL: conversation context regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
