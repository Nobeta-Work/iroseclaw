/**
 * Workflow hooks regression test
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
const { WorkflowHookRegistry } = require('../src/runtime/workflow/hooks/registry');
const { MemoryStateStore } = require('../src/runtime/state/memory-store');
const { createToolResult } = require('../src/contracts/tool');

async function main() {
  const toolRegistry = new ToolRegistry();
  const hookRegistry = new WorkflowHookRegistry({ logger: console });
  const stateStore = new MemoryStateStore();
  const sent = [];
  const seenStates = [];
  const events = [];

  await stateStore.set('room', 'room-1', {
    counter: 1
  });

  hookRegistry.register({
    async beforePlan(payload) {
      events.push(`beforePlan:${payload.workflow.step}`);
    },
    async afterPlan(payload) {
      events.push(`afterPlan:${payload.decision.status}`);
    },
    async beforeToolCall(payload) {
      events.push(`beforeTool:${payload.toolCall.name}`);
    },
    async afterToolCall(payload) {
      events.push(`afterTool:${payload.toolResult.name}:${payload.toolResult.ok}`);
    },
    async beforeOutput(payload) {
      events.push(`beforeOutput:${payload.operation.kind}`);
    },
    async afterOutput(payload) {
      events.push(`afterOutput:${payload.outputResult.operation.kind}`);
    },
    async onWorkflowFinish(payload) {
      events.push(`finish:${payload.decision.status}`);
    }
  });

  toolRegistry.register({
    name: 'state.bump',
    description: 'bump room counter',
    inputSchema: {},
    outputSchema: {},
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'low',
    timeoutMs: 1000,
    async execute() {
      return createToolResult({
        ok: true,
        name: 'state.bump',
        result: 'tool-output',
        statePatch: {
          room: {
            counter: 2
          }
        }
      });
    }
  });

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
        seenStates.push({
          workflow: { ...input.state.workflow },
          room: { ...input.state.room },
          user: { ...input.state.user }
        });

        if ((input.workflow?.toolHistory || []).length === 0) {
          return {
            status: 'needs_tools',
            toolCalls: [
              {
                callId: 'call_state_bump_1',
                name: 'state.bump',
                arguments: {}
              }
            ],
            statePatch: {
              workflow: {
                phase: 'tooling'
              }
            }
          };
        }

        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: 'workflow-finished'
          },
          statePatch: {
            workflow: {
              phase: 'done'
            },
            user: {
              lastAction: 'finished'
            }
          }
        };
      }
    },
    toolRegistry,
    outputRuntime,
    policyEngine: new PolicyEngine(),
    stateStore,
    hookRegistry
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-1',
        userId: 'u1',
        username: 'Tester',
        messageId: 'm-hook'
      },
      payload: {
        content: 'hook'
      }
    },
    protocolRequest: {
      session: {
        platform: 'iirose',
        channelId: 'room-1',
        userId: 'u1',
        username: 'Tester',
        messageId: 'm-hook'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'workflow should finish successfully');
  assert.equal(sent[0], 'tool-output', 'tool output should be sent through output runtime');
  assert.equal(sent[1], 'workflow-finished', 'final output should also be sent');
  assert.equal(seenStates[0].room.counter, 1, 'planner should receive initial room state');
  assert.equal(seenStates[0].workflow.phase, undefined, 'initial workflow state should be empty');
  assert.equal(seenStates[1].room.counter, 2, 'planner should receive updated room state after tool patch');
  assert.equal(seenStates[1].workflow.phase, 'tooling', 'planner should receive decision statePatch on next step');

  const roomState = await stateStore.get('room', 'room-1');
  const userState = await stateStore.get('user', 'u1');
  const workflowState = await stateStore.get('workflow', result.workflow.workflowId);
  assert.equal(roomState.counter, 2, 'room state should persist tool statePatch');
  assert.equal(userState.lastAction, 'finished', 'user state should persist final decision statePatch');
  assert.equal(workflowState.phase, 'done', 'workflow state should persist final workflow patch');

  assert.deepEqual(events, [
    'beforePlan:0',
    'afterPlan:needs_tools',
    'beforeTool:state.bump',
    'afterTool:state.bump:true',
    'beforeOutput:reply.current',
    'afterOutput:reply.current',
    'beforePlan:1',
    'afterPlan:final',
    'beforeOutput:reply.current',
    'afterOutput:reply.current',
    'finish:final'
  ], 'workflow hooks should run in the expected order');

  console.log('✅ PASS: workflow hooks regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow hooks regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
