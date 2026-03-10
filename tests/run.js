/**
 * Test runner
 * 依次执行测试脚本，汇总退出码
 */

const path = require('path');
const { spawnSync } = require('child_process');

const testFiles = [
  'load-test.js',
  'chat-link-regression.js'
];

let failed = 0;

for (const file of testFiles) {
  const target = path.join(__dirname, file);
  const result = spawnSync(process.execPath, [target], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\nTest summary: ${failed} script(s) failed.`);
  process.exit(1);
}

console.log('\nTest summary: all scripts passed.');
