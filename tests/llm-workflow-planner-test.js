/**
 * LLM workflow planner regression test
 */

const assert = require('assert');
const { LlmWorkflowPlanner } = require('../src/runtime/workflow/planners/llm-workflow-planner');
const { MockProvider } = require('../src/ai/providers/mock-provider');

function createChatInput(content = '你好', tools = []) {
  return {
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content
      }
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      message: {
        content
      },
      permission: {
        isAdmin: false,
        isSystemRequest: false
      },
      context: {
        triggerUser: {
          id: 'u1',
          name: 'Tester'
        },
        currentMessage: {
          userId: 'u1',
          username: 'Tester',
          content
        }
      }
    },
    availableTools: tools
  };
}

async function testFinalDecision() {
  const provider = new MockProvider({
    responses: [
      '{"status":"final","finalOutput":{"mode":"reply","text":"来自 llm planner"}}'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      maxProviderRetries: 0,
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('你好'));

  assert.equal(decision.status, 'final', 'planner should parse final decision');
  assert.equal(decision.finalOutput.text, '来自 llm planner', 'planner should preserve final output');
  assert.equal(decision.audit.planner, 'llm-default', 'planner should annotate audit with planner name');
  assert.equal(decision.audit.provider, 'mock', 'planner should annotate audit with provider name');
}

async function testNeedsToolsDecision() {
  const provider = new MockProvider({
    responses: [
      '{"status":"needs_tools","toolCalls":[{"callId":"call_music_1","name":"music.play_netease","arguments":{"song":"test"}}]}'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('点歌 test', [
      {
        name: 'music.play_netease',
        description: '点歌',
        permission: ['music'],
        scopes: ['current-session'],
        riskLevel: 'low',
        sideEffect: true
      }
    ]));

  assert.equal(decision.status, 'needs_tools', 'planner should parse needs_tools decision');
  assert.equal(decision.toolCalls[0].name, 'music.play_netease', 'planner should preserve tool name');
  assert.deepEqual(decision.toolCalls[0].arguments, { song: 'test' }, 'planner should preserve tool arguments');
}

async function testStringifiedJsonDecision() {
  const provider = new MockProvider({
    responses: [
      '"{\\"status\\":\\"final\\",\\"finalOutput\\":{\\"mode\\":\\"reply\\",\\"text\\":\\"stringified planner reply\\"}}"'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('hello'));

  assert.equal(decision.status, 'final', 'planner should accept stringified JSON decision');
  assert.equal(decision.finalOutput.text, 'stringified planner reply', 'planner should preserve unwrapped final output');
}

async function testOpenClawRetryOnProviderErrorText() {
  const provider = new MockProvider({
    label: 'openclaw',
    responses: [
      {
        ok: true,
        text: 'HTTP 400: <400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 202752]'
      },
      {
        ok: true,
        text: '{"status":"final","finalOutput":{"mode":"reply","text":"retry success"}}'
      }
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('我饿了'));

  assert.equal(provider.calls.length, 2, 'planner should retry OpenClaw once after provider-style error text');
  assert.equal(decision.status, 'final', 'planner should recover after OpenClaw retry');
  assert.equal(decision.finalOutput.text, 'retry success', 'planner should preserve retry output');
}

async function testProviderError() {
  const provider = new MockProvider({
    responses: [
      {
        ok: false,
        error: 'timeout'
      }
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('你好'));

  assert.equal(decision.status, 'error', 'planner should return error on provider failure');
  assert.ok(decision.audit.reason.includes('provider error: timeout'), 'planner should expose provider error reason');
}

async function testProviderRetriesTwiceBeforeError() {
  const provider = new MockProvider({
    responses: [
      { ok: false, error: 'timeout-1' },
      { ok: false, error: 'timeout-2' },
      { ok: false, error: 'timeout-3' }
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      maxProviderRetries: 2,
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('你好'));

  assert.equal(provider.calls.length, 3, 'planner should attempt initial call plus two retries');
  assert.equal(decision.status, 'error', 'planner should still return error after retries are exhausted');
  assert.ok(decision.audit.reason.includes('provider error:'), 'planner should preserve provider failure reason');
}

async function testFallbackToFinalOnNormalText() {
  const provider = new MockProvider({
    responses: [
      '这是一条普通回复'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('今天天气如何'));

  assert.equal(decision.status, 'final', 'non-json normal text should fall back to final reply');
  assert.equal(decision.finalOutput.text, '这是一条普通回复', 'fallback final should preserve provider text');
  assert.equal(decision.audit.reason, 'decision_parse_fallback', 'fallback reason should be explicit');
}

async function testBypassSuspiciousNeedsToolsForCodeRequest() {
  const provider = new MockProvider({
    responses: [
      '{"status":"needs_tools","toolCalls":[{"callId":"call_room_move_1","name":"iirose.room.move","arguments":{"roomId":"69ac475d24caa"}}]}',
      '```python\nprint("hello")\n```'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('输出一段python代码，使用markdown格式', [
    {
      name: 'iirose.room.move',
      description: '切换房间',
      permission: ['message.route'],
      scopes: ['channel'],
      riskLevel: 'high',
      sideEffect: true
    }
  ]));

  assert.equal(provider.calls.length, 2, 'planner should perform direct reply fallback after suspicious tool decision');
  assert.equal(provider.calls[0].json, true, 'first call should remain workflow-json mode');
  assert.equal(provider.calls[1].json, false, 'fallback call should switch to direct reply mode');
  assert.equal(decision.status, 'final', 'planner should recover with direct reply fallback');
  assert.equal(decision.finalOutput.renderMode, 'markdown', 'direct reply fallback should infer markdown render mode');
  assert.equal(decision.finalOutput.text, '```python\nprint("hello")\n```', 'direct reply fallback should preserve direct code reply');
  assert.equal(decision.audit.reason, 'agent_reply_fallback', 'fallback reason should be explicit');
}

async function testBypassLowQualityFinalForCodeRequest() {
  const provider = new MockProvider({
    responses: [
      '{"status":"final","finalOutput":{"mode":"reply","text":"输出一段go代码，使用markdown格式","renderMode":"plain"}}',
      '```go\npackage main\n\nfunc main() {\n    println("hello")\n}\n```'
    ]
  });
  const planner = new LlmWorkflowPlanner({
    provider,
    config: {
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    }
  });

  const decision = await planner.decideNextStep(createChatInput('输出一段go代码，使用markdown格式'));

  assert.equal(provider.calls.length, 2, 'planner should retry in direct reply mode for low-quality code final output');
  assert.equal(decision.status, 'final', 'planner should return final direct code reply');
  assert.equal(decision.finalOutput.renderMode, 'markdown', 'code fallback should use markdown render mode');
  assert.ok(decision.finalOutput.text.startsWith('```go'), 'code fallback should preserve fenced code');
}

async function main() {
  await testFinalDecision();
  await testNeedsToolsDecision();
  await testStringifiedJsonDecision();
  await testOpenClawRetryOnProviderErrorText();
  await testProviderError();
  await testProviderRetriesTwiceBeforeError();
  await testFallbackToFinalOnNormalText();
  await testBypassSuspiciousNeedsToolsForCodeRequest();
  await testBypassLowQualityFinalForCodeRequest();
  console.log('✅ PASS: llm workflow planner regression');
}

main().catch((error) => {
  console.error('❌ FAIL: llm workflow planner regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
