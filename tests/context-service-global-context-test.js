/**
 * Context service global shared context regression test
 */

const assert = require('assert');
const { ContextService } = require('../src/runtime/context/service');
const { MessageMemoryStore } = require('../src/plugins/message-memory');
const { buildRequest } = require('../src/core/protocol');
const { buildContextPrompt } = require('../src/runtime/workflow/prompt/serializers');
const { normalizeConfig } = require('../src/config/runtime');

function captureRound(contextService, round = {}, replyText = '') {
  const stored = contextService.captureIncomingMessage(round);
  if (stored && round && typeof round === 'object') {
    round.globalSharedEventId = stored.globalSharedEventId || null;
  }

  contextService.addBotMessage({
    channelId: round.channelId,
    userId: 'bot',
    username: 'Bot',
    content: replyText,
    timestamp: (Number(round.timestamp) || Date.now()) + 1,
    sourceScope: round.isPrivateSession === true ? 'private' : 'public',
    sourceChannelId: round.channelId,
    sourceTriggerKind: round.kind || ''
  });

  return stored;
}

async function testGlobalSharedContextRendering() {
  const contextService = new ContextService({
    persist: false,
    maxEventsPerChannel: 100,
    recentMessageCount: 5,
    channelRecentMessageCount: 5,
    anchorLookBehind: 1,
    anchorLookAhead: 1,
    detailedAnchorCount: 2,
    summaryAnchorCount: 2
  });

  const base = 1700010000000;
  const rounds = [
    {
      channelId: 'room-a',
      messageId: 'a1',
      userId: 'u1',
      username: 'Alice',
      content: '房间A 第一轮',
      rawContent: '@Bot 房间A 第一轮',
      cleanedContent: '房间A 第一轮',
      isMentioned: true,
      isPrivateSession: false,
      kind: 'message.mentioned',
      timestamp: base
    },
    {
      channelId: 'room-b',
      messageId: 'b1',
      userId: 'u2',
      username: 'Bob',
      content: '房间B 第一轮',
      rawContent: '@Bot 房间B 第一轮',
      cleanedContent: '房间B 第一轮',
      isMentioned: true,
      isPrivateSession: false,
      kind: 'message.mentioned',
      timestamp: base + 20
    },
    {
      channelId: 'private:admin-1',
      messageId: 'p1',
      userId: 'admin-1',
      username: 'Admin',
      content: '私聊检查',
      rawContent: '私聊检查',
      cleanedContent: '私聊检查',
      isMentioned: true,
      isPrivateSession: true,
      kind: 'message.private',
      timestamp: base + 40
    },
    {
      channelId: 'room-a',
      messageId: 'a2',
      userId: 'u1',
      username: 'Alice',
      content: '房间A 第二轮',
      rawContent: '@Bot 房间A 第二轮',
      cleanedContent: '房间A 第二轮',
      isMentioned: true,
      isPrivateSession: false,
      kind: 'message.mentioned',
      timestamp: base + 60
    }
  ];

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    const stored = captureRound(contextService, round, `reply-${index + 1}`);
    round.globalSharedEventId = stored?.globalSharedEventId || null;
  }

  const context = contextService.buildConversationContextFromTrigger(rounds[3], 7);

  assert.equal(context.anchorCount, 2, 'current room should keep its own anchor count');
  assert.equal(context.globalSharedAnchorCount, 4, 'global shared context should count all bot-related anchors');
  assert.ok(
    context.recentMessages.every(item => item.sourceChannelId === 'room-a'),
    'current room context should stay isolated'
  );
  assert.ok(
    context.globalSharedRecentMessages.some(item => item.sourceChannelId === 'room-b'),
    'global shared context should include other rooms'
  );
  assert.ok(
    context.globalSharedRecentMessages.some(item => item.sourceScope === 'private'),
    'global shared context should include private interactions'
  );
  assert.ok(
    context.globalSharedRecentMessages.some(item => item.sourceTriggerKind === 'message.private'),
    'global shared context should preserve trigger kind'
  );
  assert.ok(
    context.globalSharedHistorySummary.some(item => item.includes('公屏')),
    'global shared summary should expose source scope'
  );

  const request = buildRequest(
    {
      userId: 'u1',
      username: 'Alice',
      chatId: 'room-a',
      channelId: 'room-a',
      messageId: 'a2',
      platform: 'iirose'
    },
    {
      content: '房间A 第二轮',
      isBotMentioned: true
    },
    {
      isAdmin: false,
      isSystemRequest: false,
      allowedSkills: []
    },
    context
  );

  const prompt = buildContextPrompt(request);
  assert.ok(prompt.includes('当前频道最近消息'), 'standard prompt should keep current room context');
  assert.ok(prompt.includes('全局共享上下文'), 'standard prompt should include global shared context');
  assert.ok(prompt.includes('来源=私聊'), 'standard prompt should mark private sources');
  assert.ok(prompt.includes('来源=公屏'), 'standard prompt should mark public sources');
  assert.ok(prompt.includes('room-b'), 'standard prompt should include other room ids');
  assert.ok(prompt.includes('private:admin-1'), 'standard prompt should include private channel ids');

  const nativePrompt = buildContextPrompt(request, { useNativeSessionContext: true });
  assert.ok(nativePrompt.includes('补充的全局共享上下文') || nativePrompt.includes('全局共享上下文'), 'native prompt should still expose global shared context');
  assert.ok(!nativePrompt.includes('最近与 bot 相关消息'), 'native prompt should not inline local recent messages');
}

async function testDefaultRecentWindow() {
  const store = new MessageMemoryStore({
    persist: false,
    maxEventsPerChannel: 80
  });

  const base = 1700011000000;
  for (let index = 1; index <= 31; index += 1) {
    store.addUserMessage({
      channelId: 'room-default',
      userId: 'u1',
      username: 'Tester',
      content: `m${index}`,
      timestamp: base + index
    });
  }

  const context = store.buildContext({
    channelId: 'room-default',
    userId: 'u1',
    username: 'Tester',
    currentContent: 'm31',
    timestamp: base + 31
  });

  assert.equal(normalizeConfig({}).messageMemory.recentMessageCount, 30, 'runtime default recent count should be 30');
  assert.equal(store.config.recentMessageCount, 30, 'message memory store default recent count should be 30');
  assert.equal(context.recentMessages.length, 30, 'default recent window should retain 30 messages');
  assert.equal(context.recentMessages[0].content, 'm2', 'default recent window should keep the latest 30 messages');
}

async function main() {
  await testGlobalSharedContextRendering();
  await testDefaultRecentWindow();
  console.log('✅ PASS: context service global shared context regression');
}

main().catch((error) => {
  console.error('❌ FAIL: context service global shared context regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
