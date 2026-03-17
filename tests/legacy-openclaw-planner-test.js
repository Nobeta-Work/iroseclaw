/**
 * Legacy OpenClaw planner regression test
 */

const assert = require('assert');
const { LegacyOpenClawPlanner } = require('../src/runtime/workflow/planners/legacy-openclaw-planner');

async function testWorkflowStepPassThrough() {
  let seenTrigger = '';
  const planner = new LegacyOpenClawPlanner({
    adapter: {
      async processWorkflowStep(input) {
        seenTrigger = input.trigger?.kind || '';
        return {
          status: 'final',
          finalOutput: {
            mode: 'reply',
            text: 'planner-final'
          }
        };
      }
    }
  });

  const decision = await planner.decideNextStep({
    trigger: {
      kind: 'message.mentioned'
    },
    protocolRequest: {}
  });

  assert.equal(seenTrigger, 'message.mentioned', 'planner should pass workflow input to adapter');
  assert.equal(decision.status, 'final', 'planner should preserve workflow-step final decision');
  assert.equal(decision.finalOutput.text, 'planner-final', 'planner should preserve final reply text');
}

async function testLegacySkillCallFallback() {
  const planner = new LegacyOpenClawPlanner({
    adapter: {
      async processMessage() {
        return {
          isSkillCall: true,
          skillName: 'help',
          skillArgs: { topic: 'runtime' },
          replyText: '',
          audit: {
            reason: 'legacy-skill-call',
            blocked: false
          }
        };
      }
    }
  });

  const decision = await planner.decideNextStep({
    protocolRequest: {}
  });

  assert.equal(decision.status, 'needs_tools', 'planner should translate legacy skill call into tool call');
  assert.equal(decision.toolCalls.length, 1, 'planner should emit one tool call');
  assert.equal(decision.toolCalls[0].name, 'help', 'planner should use skill name as tool name');
  assert.deepEqual(decision.toolCalls[0].arguments, { topic: 'runtime' }, 'planner should preserve skill args');
}

async function testMissingAdapterError() {
  const planner = new LegacyOpenClawPlanner({});
  const decision = await planner.decideNextStep({});

  assert.equal(decision.status, 'error', 'planner should return error when adapter is unavailable');
  assert.equal(decision.audit.reason, 'workflow adapter is not available', 'planner should expose adapter-missing reason');
}

async function main() {
  await testWorkflowStepPassThrough();
  await testLegacySkillCallFallback();
  await testMissingAdapterError();
  console.log('✅ PASS: legacy OpenClaw planner regression');
}

main().catch((error) => {
  console.error('❌ FAIL: legacy OpenClaw planner regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
