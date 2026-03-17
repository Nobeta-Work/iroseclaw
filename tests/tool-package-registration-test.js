/**
 * Tool package registration regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');

async function main() {
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async () => ({})
  });

  const host = new PluginHost({
    config: {
      pluginConfigs: {
        'package-plugin': {
          enabled: true
        }
      }
    },
    logger: console,
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  const provider = {
    async complete() {
      return { ok: true, text: '' };
    }
  };
  const planner = {
    async decideNextStep() {
      return {
        status: 'final',
        finalOutput: {
          mode: 'none',
          text: ''
        }
      };
    }
  };

  host.registerPlugin({
    name: 'package-plugin',
    apply(_host, context) {
      context.registerProvider('mock-provider', provider);
      context.registerPlanner('mock-planner', planner);
      context.registerHook({ name: 'standalone-hook' });
      context.registerToolPackage({
        name: 'demo-package',
        version: '1.0.0',
        tools: [
          {
            name: 'demo.echo',
            description: 'echo',
            inputSchema: {},
            outputSchema: {},
            permission: ['chat'],
            scopes: ['current-session'],
            readOnly: true,
            sideEffect: false,
            riskLevel: 'low',
            timeoutMs: 1000,
            metadata: {
              workflowVisible: true
            },
            async execute() {
              return {
                ok: true,
                result: 'echo'
              };
            }
          }
        ],
        outputPlugins: [
          {
            transform(operation) {
              return operation;
            }
          }
        ],
        triggerTemplates: [
          {
            kind: 'demo.trigger',
            template: {
              toolNames: ['demo.echo'],
              allowDirectToolMatch: false,
              sendFallbackOnError: false,
              useConversationContext: false
            }
          }
        ],
        hooks: [
          {
            name: 'package-hook'
          }
        ]
      });
    }
  });

  const packages = host.listToolPackages();
  assert.equal(packages.length, 1, 'host should list registered tool package');
  assert.equal(packages[0].name, 'demo-package', 'tool package name should be preserved');
  assert.equal(packages[0].tools.includes('demo.echo'), true, 'tool package should register tools');
  assert.equal(host.toolRegistry.has('demo.echo'), true, 'registered tool should be visible through tool registry');
  assert.equal(host.triggerTemplateRegistry.has('demo.trigger'), true, 'tool package should register trigger template');
  assert.equal(host.getProvider('mock-provider'), provider, 'host should register provider');
  assert.equal(host.getPlanner('mock-planner'), planner, 'host should register planner');
  assert.equal(host.listHooks().length, 2, 'host should register standalone and package hooks');
  assert.equal(outputRuntime.plugins.length, 1, 'tool package output plugin should be registered');

  host.dispose();
  assert.equal(outputRuntime.plugins.length, 0, 'disposing host should cleanup output plugins registered via package context');
  console.log('✅ PASS: tool package registration regression');
}

main().catch((error) => {
  console.error('❌ FAIL: tool package registration regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
