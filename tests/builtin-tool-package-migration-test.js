/**
 * Builtin tool package migration regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const musicPlugin = require('../src/runtime/plugins/builtins/music');
const helpPlugin = require('../src/runtime/plugins/builtins/help');
const messagingToolsPlugin = require('../src/runtime/plugins/builtins/messaging-tools');
const runtimeGovernancePlugin = require('../src/runtime/plugins/builtins/runtime-governance');
const defaultTriggerTemplatesPlugin = require('../src/runtime/plugins/builtins/default-trigger-templates');
const systemPlugin = require('../src/runtime/plugins/iirose/system');

async function main() {
  const host = new PluginHost({
    config: {
      music: {},
      pluginConfigs: {}
    },
    logger: console,
    skillManager: {
      list() { return []; }
    },
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({
      policyEngine: new PolicyEngine()
    }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(musicPlugin);
  host.registerPlugin(helpPlugin);
  host.registerPlugin(messagingToolsPlugin);
  host.registerPlugin(runtimeGovernancePlugin);
  host.registerPlugin(defaultTriggerTemplatesPlugin);
  host.registerPlugin(systemPlugin);

  const packages = host.listToolPackages();
  const packageNames = packages.map(item => item.name);
  const toolNames = host.toolRegistry.list().map(tool => tool.name);

  assert.equal(packageNames.includes('builtin-music-package'), true, 'music plugin should register a tool package');
  assert.equal(packageNames.includes('builtin-help-package'), true, 'help plugin should register a tool package');
  assert.equal(packageNames.includes('builtin-messaging-tool-package'), true, 'messaging plugin should register a tool package');
  assert.equal(packageNames.includes('builtin-runtime-governance-package'), true, 'runtime governance plugin should register a tool package');
  assert.equal(packageNames.includes('builtin-default-trigger-templates-package'), true, 'default trigger templates plugin should register a tool package');
  assert.equal(packageNames.includes('iirose-system-tool-package'), true, 'iirose system plugin should register a tool package');
  assert.equal(toolNames.includes('help.show'), true, 'help package should register help tool');
  assert.equal(toolNames.includes('reply.current'), true, 'messaging package should register reply.current tool');
  assert.equal(toolNames.includes('message.route'), true, 'messaging package should register message.route tool');
  assert.equal(toolNames.includes('music.play_netease'), true, 'music package should register music tool');
  assert.equal(toolNames.includes('iirose.system.forum.get'), true, 'system package should register forum tool');
  assert.equal(toolNames.includes('iirose.system.tasks.get'), true, 'system package should register tasks tool');
  assert.equal(toolNames.includes('iirose.system.leaderboard.get'), true, 'system package should register leaderboard tool');
  assert.equal(host.triggerTemplateRegistry.has('message.mentioned'), true, 'default trigger template package should register trigger templates');
  assert.ok(host.policyEngine.rules.length >= 1, 'runtime governance package should register policy rules');

  console.log('✅ PASS: builtin tool package migration regression');
}

main().catch((error) => {
  console.error('❌ FAIL: builtin tool package migration regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
