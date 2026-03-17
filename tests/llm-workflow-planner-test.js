/**
 * LLM workflow planner regression test
 */

const assert = require('assert');
const { LlmWorkflowPlanner } = require('../src/runtime/workflow/planners/llm-workflow-planner');
const { MockProvider } = require('../src/ai/providers/mock-provider');

async function testFinalDecision() {
  const provider = new MockProvider({
    responses: [
      '{"status":"final","finalOutput":{"mode":"reply","text":"来自 llm planner"}}'
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

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: '你好'
      }
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      message: {
        content: '你好'
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
          content: '你好'
        }
      }
    },
    availableTools: []
  });

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

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: '点歌 test'
      }
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      message: {
        content: '点歌 test'
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
          content: '点歌 test'
        }
      }
    },
    availableTools: [
      {
        name: 'music.play_netease',
        description: '点歌',
        permission: ['music'],
        scopes: ['current-session'],
        riskLevel: 'low',
        sideEffect: true
      }
    ]
  });

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

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: 'hello'
      }
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      message: {
        content: 'hello'
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
          content: 'hello'
        }
      }
    },
    availableTools: []
  });

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

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: '我饿了'
      }
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      message: {
        content: '我饿了'
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
          content: '我饿了'
        }
      }
    },
    availableTools: []
  });

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

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned'
    },
    protocolRequest: {
      session: {
        userId: 'u1',
        username: 'Tester',
        channelId: 'room-1'
      },
      permission: {
        isAdmin: false,
        isSystemRequest: false
      },
      context: {}
    },
    availableTools: []
  });

  assert.equal(decision.status, 'error', 'planner should return error on provider failure');
  assert.ok(decision.audit.reason.includes('provider error: timeout'), 'planner should expose provider error reason');
}

async function main() {
  await testFinalDecision();
  await testNeedsToolsDecision();
  await testStringifiedJsonDecision();
  await testOpenClawRetryOnProviderErrorText();
  await testProviderError();
  console.log('✅ PASS: llm workflow planner regression');
}

main().catch((error) => {
  console.error('❌ FAIL: llm workflow planner regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
