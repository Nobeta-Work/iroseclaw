/**
 * Trigger template regression test
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { getTriggerTemplate, resolveTemplateTools } = require('../src/runtime/trigger/templates');
const { compileWorkflowPrompt } = require('../src/runtime/workflow/prompt/compiler');

async function main() {
  const registry = new ToolRegistry();
  registry.register({
    name: 'help.show',
    description: 'help',
    aliases: ['帮助'],
    inputSchema: {},
    outputSchema: {},
    permission: ['help'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      workflowVisible: true,
      directMatch: true
    },
    async execute() {
      return null;
    }
  });
  registry.register({
    name: 'message.route',
    description: 'route',
    aliases: [],
    inputSchema: {},
    outputSchema: {},
    permission: ['message.route'],
    scopes: ['channel'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'high',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      workflowVisible: true,
      directMatch: false
    },
    async execute() {
      return null;
    }
  });

  const mentionTemplate = getTriggerTemplate('message.mentioned');
  const paymentTemplate = getTriggerTemplate('iirose.payment');
  const mentionTools = resolveTemplateTools(registry, mentionTemplate);
  const paymentTools = resolveTemplateTools(registry, paymentTemplate);
  const triggerTemplateRegistry = new TriggerTemplateRegistry();
  const mergedPrivateTemplate = triggerTemplateRegistry.register('message.private', {
    toolNames: ['demo.extra'],
    instruction: '管理员可附加说明。'
  });
  const compiled = compileWorkflowPrompt({
    trigger: {
      kind: 'message.private'
    },
    protocolRequest: {
      permission: {
        isAdmin: true,
        isSystemRequest: false
      }
    },
    context: {
      triggerTemplate: mergedPrivateTemplate
    },
    availableTools: []
  });

  assert.equal(mentionTemplate.allowDirectToolMatch, true, 'message.mentioned should allow direct tool matching');
  assert.equal(mentionTemplate.toolNames.includes('iirose.room.move'), true, 'message.mentioned should expose room.move after command-style room migration');
  assert.equal(paymentTemplate.allowDirectToolMatch, false, 'payment trigger should not allow direct tool matching');
  assert.equal(mentionTools.some(tool => tool.name === 'help.show'), true, 'mention trigger should expose help tool');
  assert.equal(paymentTools.some(tool => tool.name === 'message.route'), true, 'payment trigger should expose route tool');
  assert.equal(mergedPrivateTemplate.toolNames.includes('monitoring.room.analyze'), true, 'plugin template should keep built-in private tools when merging');
  assert.equal(mergedPrivateTemplate.toolNames.includes('demo.extra'), true, 'plugin template should append extra tools');
  assert.equal(mergedPrivateTemplate.allowDirectToolMatch, true, 'plugin template should inherit direct tool matching from built-in private template');
  assert.equal(mergedPrivateTemplate.sendFallbackOnError, true, 'plugin template should inherit fallback behaviour from built-in private template');
  assert.equal(mergedPrivateTemplate.instruction.includes('管理员可附加说明'), true, 'plugin template should preserve custom instruction');
  assert.equal(compiled.prompt.includes('trigger instruction: '), true, 'workflow prompt should include trigger instruction');
  console.log('✅ PASS: trigger template regression');
}

main().catch((error) => {
  console.error('❌ FAIL: trigger template regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
