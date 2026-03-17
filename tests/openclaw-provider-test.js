/**
 * OpenClaw provider regression test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenClawProvider } = require('../src/ai/providers/openclaw-provider');

async function testInvocationFallback() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-provider-home-'));
  const entryPath = path.join(tempDir, 'openclaw.mjs');
  fs.writeFileSync(entryPath, '#!/usr/bin/env node\n', 'utf8');

  const previousHome = process.env.IROSE_OPENCLAW_HOME;
  const previousBin = process.env.IROSE_OPENCLAW_BIN;
  process.env.IROSE_OPENCLAW_HOME = tempDir;
  delete process.env.IROSE_OPENCLAW_BIN;

  try {
    const provider = new OpenClawProvider({
      subagentLabel: 'test-chat',
      spawnSync: () => ({ status: 127, error: new Error('missing') })
    });
    const invocation = provider._resolveOpenClawInvocation();

    assert.equal(invocation.command, process.execPath, 'provider should fall back to node executable');
    assert.equal(invocation.argsPrefix[0], entryPath, 'provider should target entry file under OPENCLAW_HOME');
  } finally {
    if (previousHome === undefined) {
      delete process.env.IROSE_OPENCLAW_HOME;
    } else {
      process.env.IROSE_OPENCLAW_HOME = previousHome;
    }

    if (previousBin === undefined) {
      delete process.env.IROSE_OPENCLAW_BIN;
    } else {
      process.env.IROSE_OPENCLAW_BIN = previousBin;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testCompleteReturnsJsonText() {
  let seenCommand = '';
  let seenArgs = [];
  const provider = new OpenClawProvider({
    subagentLabel: 'test-chat',
    execFileAsync: async (command, args) => {
      seenCommand = command;
      seenArgs = [...args];
      return {
        stdout: '{"result":{"payloads":[{"text":"provider-reply"}]}}',
        stderr: ''
      };
    },
    spawnSync: () => ({ status: 0 })
  });

  const result = await provider.complete({
    message: 'hello',
    sessionId: 'room-1',
    json: true
  });

  assert.equal(result.ok, true, 'provider should treat successful exec as ok');
  assert.equal(result.jsonText, 'provider-reply', 'provider should extract reply text from JSON payload');
  assert.equal(result.text, 'provider-reply', 'provider text should prefer JSON text');
  assert.equal(seenCommand, 'openclaw', 'provider should invoke openclaw when CLI is available');
  assert.ok(seenArgs.includes('--json'), 'provider should pass --json when requested');
  const sessionIndex = seenArgs.indexOf('--session-id');
  assert.ok(sessionIndex >= 0, 'provider should pass a session id');
  assert.notEqual(seenArgs[sessionIndex + 1], 'room-1', 'provider should isolate requests by default instead of reusing sticky session ids');
}

async function testCompleteReturnsErrorAndPartialText() {
  const provider = new OpenClawProvider({
    subagentLabel: 'test-chat',
    execFileAsync: async () => {
      const error = new Error('spawn failed');
      error.stdout = 'Gateway agent failed;\n{"result":{"payloads":[{"text":"partial"}]}}';
      error.stderr = 'spawn failed';
      throw error;
    },
    spawnSync: () => ({ status: 0 })
  });

  const result = await provider.complete({
    message: 'hello',
    sessionId: 'room-2',
    json: true
  });

  assert.equal(result.ok, false, 'provider should expose execution failure');
  assert.equal(result.jsonText, 'partial', 'provider should still extract text from error stdout');
  assert.equal(result.text, 'partial', 'provider text should expose partial reply when available');
  assert.ok(result.error.includes('partial'), 'provider error should include extracted reply or stderr context');
}

async function testStatefulSessionPreservesExplicitSessionId() {
  let seenArgs = [];
  const provider = new OpenClawProvider({
    subagentLabel: 'test-chat',
    execFileAsync: async (_command, args) => {
      seenArgs = [...args];
      return {
        stdout: '{"result":{"payloads":[{"text":"stateful-reply"}]}}',
        stderr: ''
      };
    },
    spawnSync: () => ({ status: 0 })
  });

  const result = await provider.complete({
    message: 'hello',
    sessionId: 'room-stateful',
    statefulSession: true,
    json: true
  });

  const sessionIndex = seenArgs.indexOf('--session-id');
  assert.equal(result.ok, true, 'stateful request should still succeed');
  assert.ok(sessionIndex >= 0, 'stateful request should pass a session id');
  assert.equal(seenArgs[sessionIndex + 1], 'room-stateful', 'stateful request should preserve explicit session id');
}

async function main() {
  await testInvocationFallback();
  await testCompleteReturnsJsonText();
  await testCompleteReturnsErrorAndPartialText();
  await testStatefulSessionPreservesExplicitSessionId();
  console.log('✅ PASS: openclaw provider regression');
}

main().catch((error) => {
  console.error('❌ FAIL: openclaw provider regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
