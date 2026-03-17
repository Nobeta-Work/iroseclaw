/**
 * Remote room monitoring regression test
 * 验证管理员私聊“查看房间状况”会分析 bot 当前房间并返回管理员报告。
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  await testRetryToStructuredLlmReport();
  await testExplicitLlmFailureReport();
  console.log('✅ PASS: remote room monitoring regression');
}

async function testRetryToStructuredLlmReport() {
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
    admins: ['admin_uid'],
    runtime: {
      mode: 'workflow'
    },
    workflow: {
      provider: {
        async complete(input) {
          providerCalls.push(input);
          return {
            ok: true,
            provider: 'mock-monitor',
            text: JSON.stringify({
              summary: '房间里主要是争执夹杂点歌话题，情绪有些上扬。',
              topics: ['争执', '点歌/音乐'],
              hasRisk: true,
              riskLevel: 'attention',
              riskDetails: '出现了明显的人身攻击措辞，但暂未看到持续升级到更严重威胁。',
              evidence: ['[20:00:01] Alice: 你这个傻逼别说了'],
              recommendation: '建议管理员提醒降温，并继续观察后续发言。',
              tone: '紧张'
            })
          };
        }
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

  assert.equal(typeof messageHandler, 'function', 'message handler should be registered');

  const now = Date.now();
  app.contextService.addUserMessage({
    channelId: 'room-live',
    messageId: 'room-msg-1',
    userId: 'u1',
    username: 'Alice',
    content: '你这个傻逼别说了',
    timestamp: now - 2000
  });
  app.contextService.addUserMessage({
    channelId: 'room-live',
    messageId: 'room-msg-2',
    userId: 'u2',
    username: 'Bob',
    content: '先冷静，我们刚刚还在点歌',
    timestamp: now - 1000
  });

  const sent = [];
  await messageHandler({
    content: '查看房间状况',
    userId: 'admin_uid',
    username: 'Admin',
    channelId: 'private:admin_uid',
    messageId: 'private-msg-1',
    bot: {
      internal: {
        async getRoomId() {
          return 'room-live';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['private-out-1'];
    }
  });

  assert.equal(sent.length, 1, 'monitoring command should emit a single private report');
  assert.equal(providerCalls.length, 1, 'monitoring should use configured provider when available');
  assert.equal(sent[0].includes('房间状况报告'), true, 'report should include title');
  assert.equal(sent[0].includes('房间: room-live'), true, 'report should include resolved current room');
  assert.equal(sent[0].includes('讨论摘要: 房间里主要是争执夹杂点歌话题，情绪有些上扬。'), true, 'report should use provider summary');
  assert.equal(sent[0].includes('风险判断: 需关注'), true, 'report should contain normalized risk label');
  assert.equal(sent[0].includes('分析来源: llm/mock-monitor'), true, 'report should explicitly mark llm source when provider analysis succeeds');
  assert.equal(sent[0].includes('最近 15 分钟内 2 条消息'), false, 'report should not leak raw transcript payload');
}

async function testExplicitLlmFailureReport() {
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

  let providerCalls = 0;
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
      provider: {
        async complete() {
          providerCalls += 1;
          return {
            ok: true,
            provider: 'mock-monitor',
            text: '不是 JSON'
          };
        }
      }
    },
    pluginConfigs: {
      'remote-room-monitoring': {
        maxAnalyzeRetries: 1,
        requireLlm: true
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

  const now = Date.now();
  app.contextService.addUserMessage({
    channelId: 'room-llm-fail',
    messageId: 'room-msg-fail-1',
    userId: 'u1',
    username: 'Alice',
    content: '这段聊得挺快',
    timestamp: now - 2000
  });
  app.contextService.addUserMessage({
    channelId: 'room-llm-fail',
    messageId: 'room-msg-fail-2',
    userId: 'u2',
    username: 'Bob',
    content: '但今天主要想看 LLM 报告',
    timestamp: now - 1000
  });

  const sent = [];
  await messageHandler({
    content: '查看房间状况',
    userId: 'admin_uid',
    username: 'Admin',
    channelId: 'private:admin_uid',
    messageId: 'private-msg-fail-1',
    bot: {
      internal: {
        async getRoomId() {
          return 'room-llm-fail';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['private-out-fail-1'];
    }
  });

  assert.equal(providerCalls, 2, 'invalid llm output should trigger a single retry');
  assert.equal(sent.length, 1, 'llm failure should still produce one explicit admin-facing report');
  assert.equal(sent[0].includes('LLM 状态: 本次分析失败'), true, 'llm failure should be explicit instead of silently falling back');
  assert.equal(sent[0].includes('分析来源: heuristic'), false, 'llm failure report should not masquerade as heuristic analysis');
}

main().catch((error) => {
  console.error('❌ FAIL: remote room monitoring regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
