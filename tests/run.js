/**
 * Test runner
 * 依次执行测试脚本，汇总退出码
 */

const path = require('path');
const { spawnSync } = require('child_process');

const testFiles = [
  'load-test.js',
  'chat-link-regression.js',
  'image-tag-interceptor-test.js',
  'conversation-context-test.js',
  'legacy-openclaw-planner-test.js',
  'workflow-decision-parser-test.js',
  'llm-workflow-planner-test.js',
  'llm-planner-selection-test.js',
  'workflow-default-llm-mode-test.js',
  'state-store-test.js',
  'workflow-hooks-test.js',
  'music-tool-state-test.js',
  'workflow-runtime-test.js',
  'runtime-mode-integration-test.js',
  'direct-reply-agent-integration-test.js',
  'trigger-router-test.js',
  'context-service-test.js',
  'context-service-global-context-test.js',
  'message-memory-retention-test.js',
  'tool-registry-match-test.js',
  'policy-engine-test.js',
  'hybrid-message-handler-test.js',
  'tool-package-registration-test.js',
  'builtin-tool-package-migration-test.js',
  'provider-planner-plugin-registration-test.js',
  'named-provider-default-selection-test.js',
  'meme-service-test.js',
  'help-overview-visibility-test.js',
  'chat-request-policy-test.js',
  'event-trigger-integration-test.js',
  'trigger-template-test.js',
  'chat-like-output-test.js',
  'workflow-prompt-profile-test.js',
  'prompt-persona-memory-test.js',
  'workflow-provider-silent-failure-test.js',
  'proactive-topic-engagement-test.js',
  'remote-room-monitoring-test.js',
  'workflow-run-log-test.js',
  'iirose-native-tool-groups-test.js',
  'interaction-probe-plugin-test.js',
  'tictactoe-plugin-test.js',
  'gomoku-plugin-test.js',
  'number-guess-plugin-test.js',
  'blackjack-plugin-test.js',
  'admin-workflow-prompt-test.js',
  'room-move-command-test.js',
  'music-provider-test.js',
  'music-logging-metadata-test.js',
  'plugin-host-runtime-test.js',
  'openai-compatible-provider-test.js',
  'openclaw-provider-test.js',
  'openclaw-adapter-stability-test.js',
  'openclaw-adapter-invocation-test.js'
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
