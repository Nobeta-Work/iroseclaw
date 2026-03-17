/**
 * Workflow decision parser regression test
 */

const assert = require('assert');
const { parseWorkflowDecisionText } = require('../src/runtime/workflow/decision/parser');

async function testParseDirectJson() {
  const parsed = parseWorkflowDecisionText('{"status":"final","finalOutput":{"mode":"reply","text":"hello"}}');
  assert.equal(parsed.ok, true, 'parser should accept direct JSON');
  assert.equal(parsed.decision.status, 'final', 'parser should preserve final status');
  assert.equal(parsed.decision.finalOutput.text, 'hello', 'parser should preserve final reply text');
}

async function testParseNoisyJson() {
  const text = [
    '[plugins] feishu_bitable: Registered bitable tools',
    '{"status":"needs_tools","toolCalls":[{"callId":"call_help_1","name":"help","arguments":{}}],"audit":{"blocked":false}}'
  ].join('\n');
  const parsed = parseWorkflowDecisionText(text);

  assert.equal(parsed.ok, true, 'parser should extract JSON payload from noisy text');
  assert.equal(parsed.decision.status, 'needs_tools', 'parser should parse needs_tools status');
  assert.equal(parsed.decision.toolCalls[0].name, 'help', 'parser should preserve tool name');
}

async function testParseStringifiedJson() {
  const text = '"{\\"status\\":\\"final\\",\\"finalOutput\\":{\\"mode\\":\\"reply\\",\\"text\\":\\"double encoded\\"}}"';
  const parsed = parseWorkflowDecisionText(text);

  assert.equal(parsed.ok, true, 'parser should accept stringified JSON payload');
  assert.equal(parsed.decision.status, 'final', 'parser should unwrap final status from stringified JSON');
  assert.equal(parsed.decision.finalOutput.text, 'double encoded', 'parser should preserve stringified final reply text');
}

async function testParseSingleItemArrayJson() {
  const text = '[{"status":"final","finalOutput":{"mode":"reply","text":"array wrapped"}}]';
  const parsed = parseWorkflowDecisionText(text);

  assert.equal(parsed.ok, true, 'parser should accept single-item array payload');
  assert.equal(parsed.decision.status, 'final', 'parser should unwrap final status from array payload');
  assert.equal(parsed.decision.finalOutput.text, 'array wrapped', 'parser should preserve array-wrapped final reply text');
}

async function testParseFinalOperationsPayload() {
  const text = '{"status":"final","finalOutput":{"mode":"none","text":"","operations":[{"kind":"reply.current","content":{"text":"第一条","useMemePipeline":false}},{"kind":"reply.current","content":{"text":"第二条","useMemePipeline":false}}]}}';
  const parsed = parseWorkflowDecisionText(text);

  assert.equal(parsed.ok, true, 'parser should accept finalOutput.operations payload');
  assert.equal(parsed.decision.status, 'final', 'parser should preserve final status with operations');
  assert.equal(parsed.decision.finalOutput.operations.length, 2, 'parser should preserve all final operations');
}

async function testIgnoreRangeArrayInErrorText() {
  const text = 'HTTP 400: <400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 202752]';
  const parsed = parseWorkflowDecisionText(text);

  assert.equal(parsed.ok, false, 'parser should reject provider error text as non-decision output');
  assert.equal(parsed.payload, null, 'parser should not treat bracket ranges inside error text as JSON payload');
  assert.equal(parsed.error, 'workflow decision is not valid JSON', 'parser should keep the original invalid JSON error');
}

async function testRejectInvalidPayload() {
  const parsed = parseWorkflowDecisionText('{"status":"unknown"}');
  assert.equal(parsed.ok, false, 'parser should reject invalid workflow decision status');
  assert.ok(parsed.error.includes('invalid workflow decision status'), 'parser should expose validation error');
}

async function main() {
  await testParseDirectJson();
  await testParseNoisyJson();
  await testParseStringifiedJson();
  await testParseSingleItemArrayJson();
  await testParseFinalOperationsPayload();
  await testIgnoreRangeArrayInErrorText();
  await testRejectInvalidPayload();
  console.log('✅ PASS: workflow decision parser regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow decision parser regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
