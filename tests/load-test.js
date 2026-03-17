/**
 * Minimal Load Test
 * 验证核心模块可加载和基本功能
 */

console.log('='.repeat(50));
console.log('IIROSE Claw - Minimal Load Test');
console.log('='.repeat(50));
console.log();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${error.message}`);
    failed++;
  }
}

// Test 1: Load runtime config
test('Load runtime config', () => {
  const { loadRuntimeConfig } = require('../src/config/runtime');
  const config = loadRuntimeConfig({ forceReload: true });
  
  if (!config.bot) throw new Error('Missing bot config');
  if (!config.bot.name) throw new Error('Missing bot.name');
  if (!config.admins || !Array.isArray(config.admins)) throw new Error('Invalid admins');
  if (!config.runtime?.mode) throw new Error('Missing runtime.mode');
  if (!config.workflow?.maxSteps) throw new Error('Missing workflow.maxSteps');
  if (!config.pluginConfigs || typeof config.pluginConfigs !== 'object') throw new Error('Missing pluginConfigs');
  if (!config.openclaw?.agentLabel) throw new Error('Missing openclaw.agentLabel');
  if (!config.rateLimit?.perMinute) throw new Error('Missing rateLimit.perMinute');
  
  console.log(`   Bot: ${config.bot.name} (${config.bot.uid})`);
  console.log(`   Room: ${config.roomId}`);
  console.log(`   Admins: ${config.admins.length}`);
  console.log(`   Runtime mode: ${config.runtime.mode}`);
  console.log(`   OpenClaw agent: ${config.openclaw.agentLabel}`);
});

// Test 2: Load OpenClawAdapter
test('Load OpenClawAdapter', () => {
  const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');
  const { OpenClawProvider } = require('../src/ai/providers/openclaw-provider');
  const { OpenAICompatibleProvider } = require('../src/ai/providers/openai-compatible-provider');
  const { MockProvider } = require('../src/ai/providers/mock-provider');
  const { MemoryStateStore } = require('../src/runtime/state/memory-store');
  const { WorkflowHookRegistry } = require('../src/runtime/workflow/hooks/registry');
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['test']
  });
  
  if (!adapter.config) throw new Error('Adapter config missing');
  if (adapter.config.subagentLabel !== 'test-chat') throw new Error('Config mismatch');
  if (typeof adapter.processMessage !== 'function') throw new Error('processMessage missing');
  if (!(adapter.provider instanceof OpenClawProvider)) throw new Error('Adapter provider missing');
  if (typeof OpenAICompatibleProvider !== 'function') throw new Error('OpenAICompatibleProvider export missing');
  if (typeof MockProvider !== 'function') throw new Error('MockProvider export missing');
  if (typeof MemoryStateStore !== 'function') throw new Error('MemoryStateStore export missing');
  if (typeof WorkflowHookRegistry !== 'function') throw new Error('WorkflowHookRegistry export missing');
});

// Test 3: Load SkillManager
test('Load SkillManager', () => {
  const { SkillManager } = require('../src/skills/manager');
  const manager = new SkillManager();
  
  if (!manager.skills) throw new Error('Skills map missing');
  if (typeof manager.register !== 'function') throw new Error('register method missing');
  if (typeof manager.onRegister !== 'function') throw new Error('onRegister method missing');
  if (typeof manager.execute !== 'function') throw new Error('execute method missing');
  if (typeof manager.loadBuiltin !== 'function') throw new Error('loadBuiltin method missing');
});

// Test 3b: Load ToolRegistry and workflow skeleton
test('Load ToolRegistry and planner/runtime skeletons', () => {
  const { ToolRegistry } = require('../src/tools/registry');
  const { PolicyEngine } = require('../src/runtime/policy/engine');
  const { OutputRuntime } = require('../src/runtime/output/runtime');
  const { createMemeOutputPlugin } = require('../src/runtime/output/plugins/meme-output');
  const { BaseModelProvider } = require('../src/ai/providers/base-provider');
  const { MockProvider } = require('../src/ai/providers/mock-provider');
  const { OpenClawProvider } = require('../src/ai/providers/openclaw-provider');
  const { OpenAICompatibleProvider } = require('../src/ai/providers/openai-compatible-provider');
  const { BaseWorkflowPlanner } = require('../src/runtime/workflow/planners/base-planner');
  const { LegacyOpenClawPlanner } = require('../src/runtime/workflow/planners/legacy-openclaw-planner');
  const { LlmWorkflowPlanner } = require('../src/runtime/workflow/planners/llm-workflow-planner');
  const { OpenClawWorkflowOrchestrator } = require('../src/runtime/workflow/orchestrator');
  const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
  const { WorkflowRunLog } = require('../src/runtime/audit/workflow-run-log');
  const triggerTemplates = require('../src/runtime/trigger/templates');
  const messageRuntime = require('../src/runtime/message/handler');

  const registry = new ToolRegistry();
  const policyEngine = new PolicyEngine();
  const outputRuntime = new OutputRuntime({ policyEngine });
  outputRuntime.registerPlugin(createMemeOutputPlugin({ enabled: true, triggerProbability: 1 }));
  const planner = new LegacyOpenClawPlanner({});
  const orchestrator = new OpenClawWorkflowOrchestrator({});
  const runLog = new WorkflowRunLog({
    enabled: true,
    persist: false
  });
  const runtime = new WorkflowRuntime({
    planner,
    toolRegistry: registry,
    outputRuntime,
    policyEngine,
    runLogger: runLog
  });

  if (typeof registry.register !== 'function') throw new Error('ToolRegistry.register missing');
  if (typeof policyEngine.evaluateToolCall !== 'function') throw new Error('PolicyEngine.evaluateToolCall missing');
  if (typeof outputRuntime.execute !== 'function') throw new Error('OutputRuntime.execute missing');
  if (typeof outputRuntime.executeBatch !== 'function') throw new Error('OutputRuntime.executeBatch missing');
  if (typeof BaseModelProvider !== 'function') throw new Error('BaseModelProvider export missing');
  if (typeof OpenClawProvider !== 'function') throw new Error('OpenClawProvider export missing');
  if (typeof OpenAICompatibleProvider !== 'function') throw new Error('OpenAICompatibleProvider export missing');
  if (typeof MockProvider !== 'function') throw new Error('MockProvider export missing');
  if (typeof BaseWorkflowPlanner !== 'function') throw new Error('BaseWorkflowPlanner export missing');
  if (typeof planner.decideNextStep !== 'function') throw new Error('LegacyOpenClawPlanner.decideNextStep missing');
  if (typeof LlmWorkflowPlanner !== 'function') throw new Error('LlmWorkflowPlanner export missing');
  if (typeof orchestrator.decideNextStep !== 'function') throw new Error('OpenClawWorkflowOrchestrator.decideNextStep missing');
  if (typeof runtime.run !== 'function') throw new Error('WorkflowRuntime.run missing');
  if (typeof runLog.recordRun !== 'function') throw new Error('WorkflowRunLog.recordRun missing');
  if (typeof triggerTemplates.getTriggerTemplate !== 'function') throw new Error('getTriggerTemplate missing');
  if (typeof messageRuntime.handleWorkflowMentionMessage !== 'function') throw new Error('handleWorkflowMentionMessage missing');
  if (typeof messageRuntime.handleHybridMentionMessage !== 'function') throw new Error('handleHybridMentionMessage missing');
});

// Test 4: Load and register built-in skills
test('Load built-in skills (help, music, chat)', () => {
  const { SkillManager } = require('../src/skills/manager');
  const manager = new SkillManager();
  
  manager.loadBuiltin({ skillManager: manager });
  
  const skills = manager.list();
  const skillNames = skills.map(s => s.name);
  
  if (!skillNames.includes('help')) throw new Error('help skill not loaded');
  if (!skillNames.includes('music')) throw new Error('music skill not loaded');
  if (!skillNames.includes('chat')) throw new Error('chat skill not loaded');
  
  console.log(`   Loaded skills: ${skillNames.join(', ')}`);
});

// Test 5: Load message-handler
test('Load createMessageHandler', () => {
  const { createMessageHandler } = require('../src/core/message-handler');
  const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');
  const { SkillManager } = require('../src/skills/manager');
  
  const config = {
    bot: { uid: 'test123', name: 'TestBot' },
    rateLimit: { perMinute: 60 }
  };
  
  const adapter = new OpenClawAdapter({ subagentLabel: 'test' });
  const skillManager = new SkillManager();
  
  const handler = createMessageHandler(config, adapter, skillManager);
  
  if (typeof handler !== 'function') throw new Error('Handler is not a function');
});

// Test 6: Load protocol module
test('Load protocol module', () => {
  const protocol = require('../src/core/protocol');
  
  if (typeof protocol.buildRequest !== 'function') throw new Error('buildRequest missing');
  if (typeof protocol.parseResponse !== 'function') throw new Error('parseResponse missing');
  
  // Test buildRequest
  const request = protocol.buildRequest(
    { userId: 'u1', chatId: 'c1', messageId: 'm1', platform: 'iirose' },
    { content: 'hello', mentionIds: [], isBotMentioned: true },
    { isAdmin: false, isSystemRequest: false, isOverreach: false, allowedSkills: ['chat'] }
  );
  
  if (!request.requestId) throw new Error('requestId missing');
  if (!request.session) throw new Error('session missing');
  if (!request.message) throw new Error('message missing');
  if (!request.permission) throw new Error('permission missing');
  
  // Test parseResponse
  const response = protocol.parseResponse({ replyText: 'hi', isSkillCall: false });
  if (!response.hasOwnProperty('replyText')) throw new Error('replyText missing');
  if (!response.hasOwnProperty('isSkillCall')) throw new Error('isSkillCall missing');
});

// Test 7: Load permission module
test('Load permission module', () => {
  const permission = require('../src/core/permission');
  
  if (typeof permission.isAdmin !== 'function') throw new Error('isAdmin missing');
  if (typeof permission.checkPermission !== 'function') throw new Error('checkPermission missing');
  if (typeof permission.detectSystemRequest !== 'function') throw new Error('detectSystemRequest missing');
  if (typeof permission.detectDangerousContent !== 'function') throw new Error('detectDangerousContent missing');
});

// Test 8: Load audit module
test('Load audit module', () => {
  const audit = require('../src/core/audit');
  
  if (typeof audit.logRequest !== 'function') throw new Error('logRequest missing');
  if (typeof audit.logPermissionDenied !== 'function') throw new Error('logPermissionDenied missing');
  if (typeof audit.logEvent !== 'function') throw new Error('logEvent missing');
});

// Test 9: Load main index
test('Load main index.js', () => {
  const index = require('../src/index');
  
  if (!index.name) throw new Error('Plugin name missing');
  if (typeof index.apply !== 'function') throw new Error('apply function missing');
  if (!index.OpenClawAdapter) throw new Error('OpenClawAdapter export missing');
  if (!index.SkillManager) throw new Error('SkillManager export missing');
  if (!index.ToolRegistry) throw new Error('ToolRegistry export missing');
  if (!index.WorkflowRuntime) throw new Error('WorkflowRuntime export missing');
  if (!index.ContextService) throw new Error('ContextService export missing');
  if (!index.TriggerRouter) throw new Error('TriggerRouter export missing');
  if (!index.WorkflowRunLog) throw new Error('WorkflowRunLog export missing');
  
  console.log(`   Plugin name: ${index.name}`);
});

// Test 9b: Bridge skill manager to tool registry
test('Bridge built-in skills into ToolRegistry', () => {
  const { SkillManager } = require('../src/skills/manager');
  const { ToolRegistry } = require('../src/tools/registry');
  const { bridgeSkillManagerToToolRegistry } = require('../src/tools/compat/skill-bridge');

  const skillManager = new SkillManager();
  const toolRegistry = new ToolRegistry();

  bridgeSkillManagerToToolRegistry(skillManager, toolRegistry);
  skillManager.loadBuiltin({ skillManager });

  const tools = toolRegistry.list();
  const toolNames = tools.map(tool => tool.name);

  if (!toolNames.includes('help')) throw new Error('help tool missing from bridge');
  if (!toolNames.includes('music')) throw new Error('music tool missing from bridge');
  if (!toolNames.includes('chat')) throw new Error('chat tool missing from bridge');
});

// Test 9c: Load builtin workflow tools
test('Load builtin workflow tools', () => {
  const { createHelpOverviewTool } = require('../src/tools/builtins/help-overview');
  const { createReplyCurrentTool } = require('../src/tools/builtins/reply-current');
  const { createMusicPlayNeteaseTool } = require('../src/tools/builtins/music-play-netease');
  const { createMessageRouteTool } = require('../src/tools/builtins/message-route');
  const { OutputRuntime } = require('../src/runtime/output/runtime');
  const { PolicyEngine } = require('../src/runtime/policy/engine');

  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine()
  });

  const helpTool = createHelpOverviewTool({
    listSkills: () => [],
    listTools: () => []
  });
  const replyTool = createReplyCurrentTool({ outputRuntime });
  const musicTool = createMusicPlayNeteaseTool();
  const routeTool = createMessageRouteTool({ outputRuntime });

  if (helpTool.name !== 'help.show') throw new Error('help.show tool invalid');
  if (replyTool.name !== 'reply.current') throw new Error('reply.current tool invalid');
  if (musicTool.name !== 'music.play_netease') throw new Error('music.play_netease tool invalid');
  if (routeTool.name !== 'message.route') throw new Error('message.route tool invalid');
});

// Test 10: Test skill execution
test('Test skill execution (help)', async () => {
  const { SkillManager } = require('../src/skills/manager');
  const manager = new SkillManager();
  
  manager.loadBuiltin({ skillManager: manager });
  
  const mockSession = { userId: 'test', username: 'Tester' };
  const result = await manager.execute('help', {}, mockSession);
  
  if (typeof result !== 'string') throw new Error('Help should return string');
  if (!result.includes('技能列表')) throw new Error('Help text should contain skill list');
  
  console.log(`   Help text length: ${result.length} chars`);
});

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
