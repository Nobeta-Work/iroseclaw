/**
 * IIROSE native tool groups regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const systemPlugin = require('../src/runtime/plugins/iirose/system');
const userProfilePlugin = require('../src/runtime/plugins/iirose/user-profile');
const roomPlugin = require('../src/runtime/plugins/iirose/room');

async function main() {
  const host = new PluginHost({
    config: {},
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

  host.registerPlugin(systemPlugin);
  host.registerPlugin(userProfilePlugin);
  host.registerPlugin(roomPlugin);

  const tools = host.toolRegistry.list();
  const toolNames = tools.map(tool => tool.name);
  const packageNames = host.listToolPackages().map(item => item.name);

  assert.equal(packageNames.includes('iirose-system-tool-package'), true, 'system plugin should register tool package');
  assert.equal(packageNames.includes('iirose-user-profile-tool-package'), true, 'user-profile plugin should register tool package');
  assert.equal(packageNames.includes('iirose-room-tool-package'), true, 'room plugin should register tool package');
  assert.equal(toolNames.includes('iirose.system.forum.get'), true, 'forum tool should be registered');
  assert.equal(toolNames.includes('iirose.system.tasks.get'), true, 'tasks tool should be registered');
  assert.equal(toolNames.includes('iirose.system.leaderboard.get'), true, 'leaderboard tool should be registered');
  assert.equal(toolNames.includes('iirose.user.by_name'), true, 'user.by_name tool should be registered');
  assert.equal(toolNames.includes('iirose.user.profile.by_name'), true, 'user.profile.by_name tool should be registered');
  assert.equal(toolNames.includes('iirose.user.follow_list'), true, 'user.follow_list tool should be registered');
  assert.equal(toolNames.includes('iirose.user.profile.self'), true, 'user.profile.self tool should be registered');
  assert.equal(toolNames.includes('iirose.room.current'), true, 'room.current tool should be registered');
  assert.equal(toolNames.includes('iirose.room.list'), true, 'room.list tool should be registered');
  assert.equal(toolNames.includes('iirose.room.move'), true, 'room.move tool should be registered');
  assert.equal(toolNames.includes('iirose.room.subscribe'), true, 'room.subscribe tool should be registered');
  assert.equal(toolNames.includes('iirose.room.unsubscribe'), true, 'room.unsubscribe tool should be registered');

  console.log('✅ PASS: iirose native tool groups regression');
}

main().catch((error) => {
  console.error('❌ FAIL: iirose native tool groups regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
