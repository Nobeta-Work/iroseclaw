/**
 * OpenClaw adapter stability regression test
 */

const assert = require('assert');
const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');

async function testWorkflowStepReturnsErrorOnProviderFailure() {
  const adapter = new OpenClawAdapter({
    provider: {
      async complete() {
        return {
          ok: false,
          error: 'request timeout after 30000ms',
          jsonText: '',
          plainText: ''
        };
      }
    },
    retry: {
      maxRetries: 0
    }
  });

  const decision = await adapter.processWorkflowStep({
    protocolRequest: {
      requestId: 'req-fail',
      session: { channelId: 'room-1', userId: 'u1' }
    }
  });

  assert.equal(decision.status, 'error', 'provider failure should map to workflow error');
  assert.ok(decision.audit.reason.includes('provider error'), 'provider error reason should be preserved');
}

async function testWorkflowStepTreatsProviderErrorTextAsError() {
  const adapter = new OpenClawAdapter({
    provider: {
      async complete() {
        return {
          ok: true,
          jsonText: 'HTTP 400: InternalError.Algo.InvalidParameter: Range of input length should be [1, 202752]',
          plainText: ''
        };
      }
    },
    retry: {
      maxRetries: 0
    }
  });

  const decision = await adapter.processWorkflowStep({
    protocolRequest: {
      requestId: 'req-error-text',
      session: { channelId: 'room-1', userId: 'u1' }
    }
  });

  assert.equal(decision.status, 'error', 'provider error text should map to workflow error');
  assert.ok(decision.audit.reason.includes('provider error text'), 'audit should expose provider error text path');
}

async function testWorkflowStepFallsBackToFinalOnNormalText() {
  const adapter = new OpenClawAdapter({
    provider: {
      async complete() {
        return {
          ok: true,
          jsonText: '这是一条普通回复',
          plainText: ''
        };
      }
    },
    retry: {
      maxRetries: 0
    }
  });

  const decision = await adapter.processWorkflowStep({
    protocolRequest: {
      requestId: 'req-final-fallback',
      session: { channelId: 'room-1', userId: 'u1' }
    }
  });

  assert.equal(decision.status, 'final', 'non-error plain text should fall back to final reply');
  assert.equal(decision.finalOutput.text, '这是一条普通回复', 'fallback final should preserve provider text');
  assert.equal(decision.audit.reason, 'decision_parse_fallback', 'fallback reason should be explicit');
}

async function testQueueKeyStableWithinSameRoom() {
  const adapter = new OpenClawAdapter({
    retry: { maxRetries: 0 }
  });

  const keyA = adapter._buildSessionQueueKey({
    requestId: 'req-a',
    session: { channelId: 'room-1', userId: 'u1', messageId: 'm1' }
  });
  const keyB = adapter._buildSessionQueueKey({
    requestId: 'req-b',
    session: { channelId: 'room-1', userId: 'u1', messageId: 'm2' }
  });

  assert.equal(keyA, keyB, 'queue key should be stable for same room to avoid concurrent interleaving');
}

async function main() {
  await testWorkflowStepReturnsErrorOnProviderFailure();
  await testWorkflowStepTreatsProviderErrorTextAsError();
  await testWorkflowStepFallsBackToFinalOnNormalText();
  await testQueueKeyStableWithinSameRoom();
  console.log('✅ PASS: openclaw adapter stability regression');
}

main().catch((error) => {
  console.error('❌ FAIL: openclaw adapter stability regression');
  console.error(error.stack || error.message);
  process.exit(1);
});

