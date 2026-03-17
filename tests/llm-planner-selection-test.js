/**
 * LLM planner selection regression test
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  const provider = {
    label: 'mock-provider',
    supportsStatefulSessions: true,
    async complete() {
      return {
        ok: true,
        provider: 'mock-provider',
        text: '{"status":"final","finalOutput":{"mode":"reply","text":"ok"}}'
      };
    }
  };

  const planner = index.resolveWorkflowPlanner({
    workflow: {
      planner: 'llm-default',
      provider
    },
    openclaw: {
      timeout: 30000,
      useNativeSessionContext: false
    },
    meme: {
      enabled: false,
      requestEmotionTag: false
    }
  }, {
    provider
  });

  assert.equal(typeof planner.decideNextStep, 'function', 'resolveWorkflowPlanner should return planner instance');
  assert.equal(planner.label, 'llm-default', 'resolveWorkflowPlanner should choose llm-default planner');
  assert.equal(planner.config.useNativeSessionContext, false, 'llm-default should keep native session context disabled when config requests false');

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

  assert.equal(decision.status, 'final', 'selected planner should be executable');
  assert.equal(decision.finalOutput.text, 'ok', 'selected planner should use provided provider');

  const unknownPlanner = index.resolveWorkflowPlanner({
    workflow: {
      planner: 'unknown-planner-name'
    },
    openclaw: {
      timeout: 30000,
      useNativeSessionContext: false
    },
    meme: {
      enabled: false,
      requestEmotionTag: false
    }
  }, {
    provider,
    logger: console
  });

  assert.equal(unknownPlanner.label, 'llm-default', 'unknown planner should fallback to llm-default instead of legacy planner');

  const statelessProvider = {
    label: 'stateless-provider',
    supportsStatefulSessions: false,
    async complete() {
      return {
        ok: true,
        provider: 'stateless-provider',
        text: '{"status":"final","finalOutput":{"mode":"reply","text":"ok"}}'
      };
    }
  };
  const statelessPlanner = index.resolveWorkflowPlanner({
    workflow: {
      planner: 'llm-default',
      provider: statelessProvider
    },
    openclaw: {
      timeout: 30000,
      useNativeSessionContext: true
    },
    meme: {
      enabled: false,
      requestEmotionTag: false
    }
  }, {
    provider: statelessProvider
  });

  assert.equal(
    statelessPlanner.config.useNativeSessionContext,
    false,
    'stateless providers should not receive native session-memory hints even if config requests them'
  );
  console.log('✅ PASS: llm planner selection regression');
}

main().catch((error) => {
  console.error('❌ FAIL: llm planner selection regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
