/**
 * Workflow runtime regression test
 * 验证 workflow runtime 能处理 final output、tool output 和 meme output plugin
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
const { createMemeOutputPlugin } = require('../src/runtime/output/plugins/meme-output');
const { createToolResult } = require('../src/contracts/tool');
const { createMessageRouteTool } = require('../src/tools/builtins/message-route');

async function testFinalReplyOutput() {
  const sent = [];
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });
  outputRuntime.registerPlugin(createMemeOutputPlugin({
    enabled: true,
    triggerProbability: 1
  }));

  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep() {
        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: '你好呀 [[EMO:开心]]'
          }
        };
      }
    },
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine()
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-1',
        userId: 'u1',
        username: 'Tester',
        messageId: 'm1'
      },
      payload: {
        content: 'hi'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'workflow should finalize');
  assert.equal(sent[0], '你好呀', 'visible reply should strip emotion tag');
  assert.ok(sent[1].includes('$image'), 'meme marker should be emitted as follow-up output');
}

async function testFinalOperationsOutput() {
  const sent = [];
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });

  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep() {
        return {
          status: 'final',
          finalOutput: {
            mode: 'none',
            text: '',
            operations: [
              {
                kind: 'reply.current',
                content: {
                  text: '第一条',
                  useMemePipeline: false
                }
              },
              {
                kind: 'reply.current',
                content: {
                  text: '第二条',
                  useMemePipeline: false
                }
              }
            ]
          }
        };
      }
    },
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine()
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-final-ops',
        userId: 'u-final-ops',
        username: 'FinalOps',
        messageId: 'm-final-ops'
      },
      payload: {
        content: 'ops'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'final operations test should finish');
  assert.equal(Array.isArray(result.finalOutputResults), true, 'runtime should expose final output batch results');
  assert.equal(result.finalOutputResults.length, 2, 'runtime should execute all final output operations');
  assert.equal(sent[0], '第一条', 'final operations should keep output order');
  assert.equal(sent[1], '第二条', 'final operations should emit all planned outputs');
}

async function testToolStringOutput() {
  const registry = new ToolRegistry();
  registry.register({
    name: 'help',
    description: 'help',
    inputSchema: {},
    outputSchema: {},
    permission: ['help'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    async execute() {
      return createToolResult({
        ok: true,
        name: 'help',
        result: '这是帮助文本'
      });
    }
  });

  const sent = [];
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });

  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep(input) {
        if ((input.workflow?.toolHistory || []).length > 0) {
          return {
            status: 'final',
            finalOutput: {
              mode: 'none',
              text: ''
            }
          };
        }

        return {
          status: 'needs_tools',
          toolCalls: [
            {
              callId: 'call_help_1',
              name: 'help',
              arguments: {}
            }
          ]
        };
      }
    },
    toolRegistry: registry,
    outputRuntime,
    policyEngine: new PolicyEngine()
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-1',
        userId: 'u1',
        username: 'Tester',
        messageId: 'm2'
      },
      payload: {
        content: 'help'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'workflow should finish after tool execution');
  assert.equal(result.workflow.toolHistory.length, 1, 'tool result should be recorded');
  assert.equal(Array.isArray(result.outputResults), true, 'workflow result should expose emitted tool output results');
  assert.equal(result.outputResults.length, 1, 'workflow result should return emitted tool outputs');
  assert.equal(sent[0], '这是帮助文本', 'string tool result should be sent through output runtime');
}

async function testHighRiskRouteBlockedByPolicy() {
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine()
  });
  const routeTool = createMessageRouteTool({ outputRuntime });

  const result = await routeTool.execute({
    session: {
      userId: 'u1',
      username: 'Tester'
    }
  }, {
    text: '跨房间消息',
    target: {
      scope: 'channel',
      channelId: 'room-2'
    }
  });

  assert.equal(result.ok, false, 'message.route should be blocked by default policy');
  assert.ok(result.error.includes('cross-session'), 'blocked reason should mention cross-session policy');
}

async function testMultiStepWorkflowLoop() {
  const registry = new ToolRegistry();
  registry.register({
    name: 'query.echo',
    description: 'echo query',
    inputSchema: {},
    outputSchema: {},
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    async execute(_context, input) {
      return createToolResult({
        ok: true,
        name: 'query.echo',
        result: `tool:${input.query || ''}`
      });
    }
  });

  const sent = [];
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });

  let steps = 0;
  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep(input) {
        steps += 1;
        if ((input.workflow?.toolHistory || []).length === 0) {
          return {
            status: 'needs_tools',
            toolCalls: [
              {
                callId: 'call_echo_1',
                name: 'query.echo',
                arguments: { query: 'hello' }
              }
            ]
          };
        }

        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: '多步完成'
          }
        };
      }
    },
    toolRegistry: registry,
    outputRuntime,
    policyEngine: new PolicyEngine()
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-2',
        userId: 'u2',
        username: 'Looper',
        messageId: 'm-loop'
      },
      payload: {
        content: 'loop'
      }
    }
  });

  assert.equal(steps, 2, 'workflow should continue after tool execution');
  assert.equal(result.decision.status, 'final', 'workflow should end with final output');
  assert.equal(result.workflow.toolHistory.length, 1, 'tool history should be preserved across steps');
  assert.equal(result.outputResults.length, 1, 'multi-step workflow should preserve intermediate tool outputs in top-level result');
  assert.equal(sent[0], 'tool:hello', 'tool output should be emitted before final output');
  assert.equal(sent[1], '多步完成', 'final output should be emitted after second step');
}

async function testWorkflowOutputBudget() {
  const sent = [];
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine({
      maxMessagesPerWorkflow: 1
    }),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });
  outputRuntime.registerPlugin(createMemeOutputPlugin({
    enabled: true,
    triggerProbability: 1
  }));

  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep() {
        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: '预算测试 [[EMO:开心]]'
          }
        };
      }
    },
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine({
      maxMessagesPerWorkflow: 1
    })
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-budget',
        userId: 'u3',
        username: 'Budget',
        messageId: 'm-budget'
      },
      payload: {
        content: 'budget'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'budget test should still finish');
  assert.equal(sent.length, 1, 'workflow output budget should block second output');
  assert.equal(sent[0], '预算测试', 'first visible reply should still be sent');
}

async function main() {
  await testFinalReplyOutput();
  await testFinalOperationsOutput();
  await testToolStringOutput();
  await testHighRiskRouteBlockedByPolicy();
  await testMultiStepWorkflowLoop();
  await testWorkflowOutputBudget();
  console.log('✅ PASS: workflow runtime regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow runtime regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
