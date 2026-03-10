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
  if (!config.openclaw?.subagentLabel) throw new Error('Missing openclaw.subagentLabel');
  if (!config.rateLimit?.perMinute) throw new Error('Missing rateLimit.perMinute');
  
  console.log(`   Bot: ${config.bot.name} (${config.bot.uid})`);
  console.log(`   Room: ${config.roomId}`);
  console.log(`   Admins: ${config.admins.length}`);
  console.log(`   Subagent: ${config.openclaw.subagentLabel}`);
});

// Test 2: Load OpenClawAdapter
test('Load OpenClawAdapter', () => {
  const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['test']
  });
  
  if (!adapter.config) throw new Error('Adapter config missing');
  if (adapter.config.subagentLabel !== 'test-chat') throw new Error('Config mismatch');
});

// Test 3: Load SkillManager
test('Load SkillManager', () => {
  const { SkillManager } = require('../src/skills/manager');
  const manager = new SkillManager();
  
  if (!manager.skills) throw new Error('Skills map missing');
  if (typeof manager.register !== 'function') throw new Error('register method missing');
  if (typeof manager.execute !== 'function') throw new Error('execute method missing');
  if (typeof manager.loadBuiltin !== 'function') throw new Error('loadBuiltin method missing');
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
  
  console.log(`   Plugin name: ${index.name}`);
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
