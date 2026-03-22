/**
 * Proactive topic engagement regression test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const index = require('../src/index');

function createTestContext() {
  const handlers = new Map();

  return {
    on(event, handler) {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event).push(handler);
      return () => {
        const bucket = handlers.get(event) || [];
        handlers.set(event, bucket.filter(item => item !== handler));
      };
    },
    before() {},
    bots: [],
    _handlers: handlers
  };
}

async function dispatchMessage(ctx, session) {
  const handlers = ctx._handlers.get('message') || [];
  for (const handler of handlers) {
    await handler(session);
  }
}

async function flushTimers() {
  await new Promise(resolve => setTimeout(resolve, 5));
}

async function testAdminControls() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-engagement-admin-'));
  const ctx = createTestContext();

  try {
    const app = index.apply(ctx, {
      bot: {
        uid: 'bot_uid',
        name: 'TestBot'
      },
      admins: ['admin_uid'],
      runtime: {
        mode: 'workflow'
      },
      pluginConfigs: {
        'proactive-topic-engagement': {
          dataDir: tempDir
        }
      },
      messageMemory: {
        persist: false
      },
      meme: {
        enabled: false,
        triggerProbability: 0,
        requestEmotionTag: false
      }
    });

    const service = app.pluginHost.getService('proactive.topic-engagement');
    assert.ok(service, 'topic engagement service should be registered');
    assert.equal(service.getStatus().enabled, false, 'topic engagement should default to disabled');

    const sent = [];

    await dispatchMessage(ctx, {
      content: '命名主动模式 茶水间模式',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-rename-1',
      send: async (text) => {
        sent.push(text);
        return ['private-out-rename'];
      }
    });
    await service.awaitIdle();

    assert.equal(service.getStatus().modeName, '茶水间模式', 'rename command should update mode name');
    assert.equal(sent[sent.length - 1].includes('茶水间模式'), true, 'rename command should acknowledge updated mode name');

    await dispatchMessage(ctx, {
      content: '开启主动模式',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-enable-1',
      send: async (text) => {
        sent.push(text);
        return ['private-out-enable'];
      }
    });
    await service.awaitIdle();

    assert.equal(service.getStatus().enabled, true, 'enable command should switch service on');

    await dispatchMessage(ctx, {
      content: '主动模式状态',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-status-1',
      send: async (text) => {
        sent.push(text);
        return ['private-out-status'];
      }
    });
    await service.awaitIdle();

    const statusReply = sent[sent.length - 1];
    assert.equal(statusReply.includes('主动话题介入状态'), true, 'status command should render status header');
    assert.equal(statusReply.includes('茶水间模式'), true, 'status command should include current mode name');
    assert.equal(statusReply.includes('已开启'), true, 'status command should reflect enabled state');

    await dispatchMessage(ctx, {
      content: '关闭主动模式',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-disable-1',
      send: async (text) => {
        sent.push(text);
        return ['private-out-disable'];
      }
    });
    await service.awaitIdle();

    assert.equal(service.getStatus().enabled, false, 'disable command should switch service off');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testHighFrequencyIntervention() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-engagement-room-'));
  const ctx = createTestContext();
  const capturedPrompts = [];
  const provider = {
    label: 'mock-provider',
    async complete(input = {}) {
      capturedPrompts.push(input.message || input.userPrompt || '');
      return {
        ok: true,
        provider: 'mock-provider',
        text: JSON.stringify({
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: '轻轻接一句'
          }
        })
      };
    }
  };

  try {
    const app = index.apply(ctx, {
      bot: {
        uid: 'bot_uid',
        name: 'TestBot'
      },
      admins: ['admin_uid'],
      runtime: {
        mode: 'workflow'
      },
      workflow: {
        provider
      },
      pluginConfigs: {
        'proactive-topic-engagement': {
          dataDir: tempDir,
          defaultEnabled: true,
          defaultModeName: '茶水间模式',
          windowMs: 60000,
          minMessages: 4,
          minParticipants: 3,
          maxAverageGapMs: 60000,
          maxSpeakerRatio: 0.8,
          minBotSilenceMs: 0,
          cooldownMs: 300000
        }
      },
      messageMemory: {
        persist: false
      },
      meme: {
        enabled: false,
        triggerProbability: 0,
        requestEmotionTag: false
      }
    });

    const service = app.pluginHost.getService('proactive.topic-engagement');
    const sent = [];
    const roomMessages = [
      { userId: 'u1', username: 'Alice', content: '这首歌副歌真熟' },
      { userId: 'u2', username: 'Bob', content: '还点歌吗' },
      { userId: 'u3', username: 'Carol', content: '下一首放啥' },
      { userId: 'u1', username: 'Alice', content: '这波像在拼歌单' }
    ];

    for (let index = 0; index < roomMessages.length; index += 1) {
      const item = roomMessages[index];
      await dispatchMessage(ctx, {
        content: item.content,
        userId: item.userId,
        username: item.username,
        channelId: 'room-1',
        messageId: `room-msg-${index + 1}`,
        send: async (text) => {
          sent.push(text);
          return [`room-out-${sent.length}`];
        }
      });
      await flushTimers();
    }
    await service.awaitIdle();

    assert.equal(
      sent.length,
      1,
      `high-frequency room chat should trigger one proactive interjection: sent=${JSON.stringify(sent)} status=${JSON.stringify(service.getStatus())}`
    );
    assert.equal(sent[0], '轻轻接一句', 'proactive plugin should reuse workflow chat output');
    assert.equal(capturedPrompts.length, 1, 'proactive burst should invoke workflow provider once');
    assert.equal(capturedPrompts[0].includes('当前 trigger: message.proactive'), true, 'workflow prompt should mark proactive trigger kind');
    assert.equal(capturedPrompts[0].includes('trigger instruction: 这是一次主动话题介入触发'), true, 'workflow prompt should include proactive trigger instruction');
    assert.equal(capturedPrompts[0].includes('当前频道最近消息(按时间升序):'), true, 'workflow prompt should include room window context');
    assert.equal(capturedPrompts[0].includes('最近与 bot 相关消息'), false, 'proactive workflow should avoid mention-history context');
    assert.equal(capturedPrompts[0].includes('茶水间模式'), true, 'workflow prompt should include proactive mode metadata');

    const assistantMessages = app.contextService.getMessagesInWindow('room-1', 0, Date.now() + 1, { roles: ['assistant'] });
    assert.equal(assistantMessages.length, 0, 'proactive workflow output should not be recorded into message memory');

    const moreRoomMessages = [
      { userId: 'u2', username: 'Bob', content: '这首也能接上' },
      { userId: 'u3', username: 'Carol', content: '歌单越聊越离谱' },
      { userId: 'u1', username: 'Alice', content: '再点一首就懂了' },
      { userId: 'u4', username: 'Dave', content: '副歌是真的熟' }
    ];

    for (let index = 0; index < moreRoomMessages.length; index += 1) {
      const item = moreRoomMessages[index];
      await dispatchMessage(ctx, {
        content: item.content,
        userId: item.userId,
        username: item.username,
        channelId: 'room-1',
        messageId: `room-msg-repeat-${index + 1}`,
        send: async (text) => {
          sent.push(text);
          return [`room-out-repeat-${sent.length}`];
        }
      });
      await flushTimers();
    }
    await service.awaitIdle();

    assert.equal(sent.length, 1, 'cooldown should prevent repeated proactive interjections in the same burst window');
    assert.equal(capturedPrompts.length, 1, 'cooldown should also suppress repeated workflow invocations');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await testAdminControls();
  await testHighFrequencyIntervention();
  console.log('✅ PASS: proactive topic engagement regression');
}

main().catch((error) => {
  console.error('❌ FAIL: proactive topic engagement regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
