/**
 * Plugin host runtime regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
const { WorkflowRunLog } = require('../src/runtime/audit/workflow-run-log');

async function testDispatchTrigger() {
  const sent = [];
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'echo.tool',
    description: 'echo',
    aliases: ['echo'],
    inputSchema: {},
    outputSchema: {},
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      workflowVisible: true
    },
    async execute() {
      return {
        ok: true,
        result: 'tool-output'
      };
    }
  });

  const triggerTemplateRegistry = new TriggerTemplateRegistry();
  triggerTemplateRegistry.register('scheduler.proactive', {
    toolNames: ['echo.tool'],
    allowDirectToolMatch: false,
    sendFallbackOnError: false,
    useConversationContext: false
  });

  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });

  const workflowRuntime = new WorkflowRuntime({
    planner: {
      async decideNextStep(input) {
        if ((input.workflow?.toolHistory || []).length === 0) {
          return {
            status: 'needs_tools',
            toolCalls: [
              {
                callId: 'call_echo_1',
                name: 'echo.tool',
                arguments: {}
              }
            ]
          };
        }
        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: 'final-output'
          }
        };
      }
    },
    toolRegistry,
    outputRuntime,
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry,
    runLogger: new WorkflowRunLog({ enabled: true, persist: false })
  });

  const host = new PluginHost({
    config: {
      pluginConfigs: {
        'test-plugin': {
          enabled: true
        }
      }
    },
    logger: console,
    ctx: {},
    skillManager: {
      list() { return []; }
    },
    toolRegistry,
    outputRuntime,
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry,
    workflowRuntime,
    pickFallback: () => 'fallback'
  });

  const result = await host.dispatchTrigger({
    kind: 'scheduler.proactive',
    session: {
      platform: 'iirose',
      channelId: 'room-1',
      userId: 'system:scheduler',
      username: 'Scheduler',
      messageId: ''
    },
    payload: {
      content: 'tick'
    }
  }, {
    context: {
      session: {
        userId: 'system:scheduler',
        username: 'Scheduler'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'dispatchTrigger should run full workflow');
  assert.equal(Array.isArray(result.outputResults), true, 'dispatchTrigger should expose emitted tool outputs');
  assert.equal(result.outputResults.length, 1, 'dispatchTrigger should return intermediate tool outputs');
  assert.equal(sent[0], 'tool-output', 'tool result should be emitted through output runtime');
  assert.equal(sent[1], 'final-output', 'final output should also be emitted');
}

async function testPluginContextHelpers() {
  const host = new PluginHost({
    config: {
      pluginConfigs: {
        'sample-plugin': {
          foo: 'bar'
        }
      }
    },
    logger: console,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({ policyEngine: new PolicyEngine() }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  let capturedConfig = null;
  let cleanedUp = false;

  host.registerPlugin({
    name: 'sample-plugin',
    apply(_host, context) {
      capturedConfig = context.getPluginConfig();
      context.registerCleanup(() => {
        cleanedUp = true;
      });
    }
  });

  assert.deepEqual(capturedConfig, { foo: 'bar' }, 'plugin should receive its scoped config');
  host.dispose();
  assert.equal(cleanedUp, true, 'plugin cleanup should run on dispose');
}

async function main() {
  await testDispatchTrigger();
  await testPluginContextHelpers();
  console.log('✅ PASS: plugin host runtime regression');
}

main().catch((error) => {
  console.error('❌ FAIL: plugin host runtime regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
