/**
 * Provider / planner plugin registration regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const openclawProviderPlugin = require('../src/runtime/plugins/builtins/openclaw-provider');
const openaiCompatibleProvidersPlugin = require('../src/runtime/plugins/builtins/openai-compatible-providers');
const workflowPlannersPlugin = require('../src/runtime/plugins/builtins/workflow-planners');
const legacyCompatPlugin = require('../src/runtime/plugins/builtins/legacy-openclaw-compat');

async function main() {
  const host = new PluginHost({
    config: {
      openclaw: {
        subagentLabel: 'test-chat',
        timeout: 5000,
        local: true
      },
      providers: {
        default: 'openclaw',
        named: {
          'analysis-http': {
            type: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            model: 'gpt-test',
            enabled: true
          }
        }
      },
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    },
    logger: console,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({
      policyEngine: new PolicyEngine()
    }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(openclawProviderPlugin);
  host.registerPlugin(openaiCompatibleProvidersPlugin);
  host.registerPlugin(workflowPlannersPlugin);
  host.registerPlugin(legacyCompatPlugin);

  assert.equal(host.listProviders().includes('openclaw'), true, 'openclaw provider plugin should register provider');
  assert.equal(host.listProviders().includes('openclaw-agent'), true, 'openclaw provider plugin should expose explicit agent bridge alias');
  assert.equal(host.listProviders().includes('analysis-http'), true, 'named openai-compatible provider should register provider');
  assert.equal(host.listPlanners().includes('llm-default'), true, 'workflow planners plugin should register llm-default planner');
  assert.equal(host.listPlanners().includes('legacy-openclaw'), true, 'legacy compat plugin should register legacy planner');

  const providerFactory = host.getProvider('openclaw');
  assert.equal(typeof providerFactory, 'function', 'registered openclaw provider should be a factory');

  const plannerFactory = host.getPlanner('llm-default');
  assert.equal(typeof plannerFactory, 'function', 'registered llm-default planner should be a factory');

  const provider = providerFactory({
    config: host.config,
    logger: console,
    host
  });
  const analysisProviderFactory = host.getProvider('analysis-http');
  const analysisProvider = analysisProviderFactory({
    config: host.config,
    logger: console,
    host
  });
  const planner = plannerFactory({
    config: host.config,
    logger: console,
    host,
    provider
  });

  assert.equal(typeof provider.complete, 'function', 'resolved provider factory should create provider instance');
  assert.equal(typeof analysisProvider.complete, 'function', 'named provider factory should create provider instance');
  assert.equal(typeof planner.decideNextStep, 'function', 'resolved planner factory should create planner instance');
  console.log('✅ PASS: provider planner plugin registration regression');
}

main().catch((error) => {
  console.error('❌ FAIL: provider planner plugin registration regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
