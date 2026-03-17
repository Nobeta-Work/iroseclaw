/**
 * Workflow run log regression test
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WorkflowRunLog } = require('../src/runtime/audit/workflow-run-log');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irose-workflow-log-'));
  const runLog = new WorkflowRunLog({
    enabled: true,
    dataDir: tempDir,
    fileName: 'runs.log.jsonl',
    persist: true
  });

  const now = Date.now();
  const entry = runLog.recordRun({
    workflowId: 'wf_test',
    requestId: 'req_test',
    trigger: {
      kind: 'message.mentioned'
    },
    decisionHistory: [{ status: 'final' }],
    toolHistory: [],
    outputHistory: [],
    status: 'final',
    startedAt: now,
    finishedAt: now + 1
  });

  const files = fs.readdirSync(tempDir);
  assert.equal(entry.workflowId, 'wf_test', 'run log should preserve workflow id');
  assert.deepEqual(files, ['runs.log.jsonl'], 'run log should use a fixed single file');

  const fileContent = fs.readFileSync(path.join(tempDir, files[0]), 'utf8').trim();
  const parsed = JSON.parse(fileContent);
  assert.equal(parsed.status, 'final', 'persisted run log should preserve status');

  const compactingRunLog = new WorkflowRunLog({
    enabled: true,
    dataDir: tempDir,
    fileName: 'compact.log.jsonl',
    maxBytes: 500,
    targetBytesAfterCompact: 260,
    compactCheckInterval: 1,
    persist: true
  });

  for (let index = 0; index < 20; index += 1) {
    compactingRunLog.recordRun({
      workflowId: `wf_${index}`,
      requestId: `req_${index}`,
      status: 'error',
      decisionHistory: [{ status: 'error', audit: { reason: `r${index}` } }],
      startedAt: now + index + 2,
      finishedAt: now + index + 3
    });
  }

  const compactPath = path.join(tempDir, 'compact.log.jsonl');
  const compactStat = fs.statSync(compactPath);
  assert.ok(compactStat.size <= 500, 'compacted workflow log should stay within maxBytes');
  const compactLines = fs.readFileSync(compactPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  assert.ok(compactLines.length > 0, 'compacted workflow log should keep recent entries');
  const latest = JSON.parse(compactLines[compactLines.length - 1]);
  assert.equal(latest.workflowId, 'wf_19', 'compacted workflow log should retain latest entries');

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('✅ PASS: workflow run log regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow run log regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
