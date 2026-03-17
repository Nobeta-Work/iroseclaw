/**
 * IIROSE interaction probe plugin regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const interactionProbePlugin = require('../src/runtime/plugins/iirose/interaction-probe');

async function main() {
  const listeners = new Map();
  const ctx = {
    on(eventName, callback) {
      listeners.set(eventName, callback);
      return () => listeners.delete(eventName);
    }
  };

  const host = new PluginHost({
    config: {
      pluginConfigs: {
        'iirose-interaction-probe': {
          persist: false,
          maxRecentEvents: 10
        }
      }
    },
    logger: console,
    ctx,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({
      policyEngine: new PolicyEngine(),
      sender: async () => ({})
    }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(interactionProbePlugin);

  assert.equal(host.toolRegistry.has('iirose.interaction.probe.send'), true, 'send probe tool should be registered');
  assert.equal(host.toolRegistry.has('iirose.interaction.probe.recent'), true, 'recent probe tool should be registered');
  assert.equal(typeof listeners.get('message'), 'function', 'plugin should subscribe to message events');

  const sendResult = await host.toolRegistry.execute('iirose.interaction.probe.send', {
    session: {
      userId: '69934939dd954',
      username: '梦语',
      channelId: 'room-1'
    }
  }, {});

  assert.equal(sendResult.ok, true, 'send probe tool should succeed');
  assert.equal(
    sendResult.result.includes('[.%69934939dd954.]'),
    true,
    'probe output should contain canonical token'
  );
  assert.equal(
    sendResult.result.includes('小艾加入%69934939dd954'),
    true,
    'probe output should contain control command'
  );

  const onMessage = listeners.get('message');
  onMessage({
    content: '小艾加入%69934939dd954',
    username: 'ABin',
    userId: '60e7a4b4225cb',
    channelId: 'room-1',
    timestamp: 1773572439000
  });
  onMessage({
    content: '<at id="69934939dd954" name="梦语"/> 加入游戏 [.%69934939dd954.]',
    username: '艾薇',
    userId: '56c9c1bf05262',
    channelId: 'room-1',
    timestamp: 1773572439001
  });

  const recentResult = await host.toolRegistry.execute('iirose.interaction.probe.recent', {
    session: {
      channelId: 'room-1'
    }
  }, {});

  assert.equal(recentResult.ok, true, 'recent probe tool should succeed');
  assert.equal(
    recentResult.result.includes('小艾加入%69934939dd954'),
    true,
    'recent probe output should include captured join command'
  );
  assert.equal(
    recentResult.result.includes('[probe-token] 艾薇'),
    true,
    'recent probe output should include captured token event from target bot'
  );

  host.dispose();
  assert.equal(listeners.has('message'), false, 'plugin cleanup should unsubscribe message listener');

  console.log('✅ PASS: interaction probe plugin regression');
}

main().catch((error) => {
  console.error('❌ FAIL: interaction probe plugin regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
