/**
 * Hybrid runtime message handler regression test
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
const { createMemeOutputPlugin } = require('../src/runtime/output/plugins/meme-output');
const { handleHybridMentionMessage } = require('../src/runtime/message/handler');

async function main() {
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

  const result = await handleHybridMentionMessage({
    trigger: {
      cleanedContent: '普通聊天',
      rawContent: '普通聊天',
      userId: 'u1',
      username: 'Tester',
      channelId: 'room-hybrid',
      messageId: 'm-hybrid',
      timestamp: Date.now()
    },
    session: {
      userId: 'u1',
      username: 'Tester'
    },
    ctx: {},
    botProfile: {
      uid: 'bot',
      name: 'Bot'
    },
    toolRegistry: new ToolRegistry(),
    workflowRuntime: new WorkflowRuntime({
      planner: {
        async decideNextStep() {
          return {
            status: 'final',
            finalOutput: {
              mode: 'none',
              text: ''
            }
          };
        }
      },
      toolRegistry: new ToolRegistry(),
      outputRuntime,
      policyEngine: new PolicyEngine()
    }),
    outputRuntime,
    pickFallback: () => 'fallback',
    contextService: {
      addBotMessage() {}
    },
    legacyChatHandler: async () => '混合回复 [[EMO:开心]]'
  });

  assert.equal(result.mode, 'hybrid-chat', 'hybrid mode should use legacy chat handler when no direct tool matches');
  assert.equal(sent[0], '混合回复', 'hybrid visible reply should strip emotion tag via output runtime');
  assert.ok(sent[1].includes('$image'), 'hybrid mode should still emit meme marker through output pipeline');
  console.log('✅ PASS: hybrid message handler regression');
}

main().catch((error) => {
  console.error('❌ FAIL: hybrid message handler regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
