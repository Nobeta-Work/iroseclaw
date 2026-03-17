/**
 * OpenClaw adapter invocation fallback test
 * 验证 CLI 缺失时会回退到包目录入口文件
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    failed += 1;
  }
}

test('falls back to IROSE_OPENCLAW_HOME/openclaw.mjs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-home-'));
  const entryPath = path.join(tempDir, 'openclaw.mjs');
  fs.writeFileSync(entryPath, '#!/usr/bin/env node\n', 'utf8');

  const previousHome = process.env.IROSE_OPENCLAW_HOME;
  const previousBin = process.env.IROSE_OPENCLAW_BIN;
  process.env.IROSE_OPENCLAW_HOME = tempDir;
  delete process.env.IROSE_OPENCLAW_BIN;

  try {
    const adapter = new OpenClawAdapter({ subagentLabel: 'test-chat' });
    const invocation = adapter._resolveOpenClawInvocation();

    if (invocation.command !== process.execPath) {
      throw new Error(`expected node executable, got ${invocation.command}`);
    }

    if (!Array.isArray(invocation.argsPrefix) || invocation.argsPrefix[0] !== entryPath) {
      throw new Error(`expected argsPrefix[0] to be ${entryPath}`);
    }
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
});

test('prefers explicit IROSE_OPENCLAW_BIN when provided', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-bin-'));
  const binPath = path.join(tempDir, 'openclaw.mjs');
  fs.writeFileSync(binPath, '#!/usr/bin/env node\n', 'utf8');

  const previousHome = process.env.IROSE_OPENCLAW_HOME;
  const previousBin = process.env.IROSE_OPENCLAW_BIN;
  process.env.IROSE_OPENCLAW_BIN = binPath;
  delete process.env.IROSE_OPENCLAW_HOME;

  try {
    const adapter = new OpenClawAdapter({ subagentLabel: 'test-chat' });
    const invocation = adapter._resolveOpenClawInvocation();

    if (invocation.command !== process.execPath) {
      throw new Error(`expected node executable, got ${invocation.command}`);
    }

    if (!Array.isArray(invocation.argsPrefix) || invocation.argsPrefix[0] !== binPath) {
      throw new Error(`expected argsPrefix[0] to be ${binPath}`);
    }
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
});

if (failed > 0) {
  process.exit(1);
}

console.log(`Summary: ${passed} passed, ${failed} failed.`);
