/**
 * Skills-first workflow framework regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { ContextService } = require('../src/runtime/context/service');
const contextParticipantsPlugin = require('../src/runtime/plugins/builtins/context-participants');
const communicationPrivateMessagingPlugin = require('../src/runtime/plugins/builtins/communication-private-messaging');
const { compileWorkflowPrompt } = require('../src/runtime/workflow/prompt/compiler');

async function main() {
  const sent = [];
  const ctx = {
    bots: [
      {
        async sendMessage(channelId, text) {
          sent.push({ channelId, text });
          return ['mid-1'];
        }
      }
    ]
  };
  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async () => ({})
  });
  const contextService = new ContextService({
    enabled: true,
    persist: false,
    recentMessageCount: 20,
    channelRecentMessageCount: 12
  });
  const host = new PluginHost({
    config: {
      bot: {
        uid: 'bot-1',
        name: 'Bot'
      },
      admins: ['admin-1']
    },
    logger: console,
    ctx,
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry(),
    contextService
  });

  host.registerPlugin(contextParticipantsPlugin);
  host.registerPlugin(communicationPrivateMessagingPlugin);

  const skills = host.listSkills();
  assert.equal(skills.some(skill => skill.id === 'context.participant-resolution'), true, 'context participants skill should be registered');
  assert.equal(skills.some(skill => skill.id === 'communication.private-messaging'), true, 'private messaging skill should be registered');

  contextService.addUserMessage({
    channelId: 'room-1',
    userId: 'user-a',
    username: 'Alice',
    content: '你先别吵',
    rawContent: '你先别吵',
    timestamp: Date.now() - 3000
  });
  contextService.addUserMessage({
    channelId: 'room-1',
    userId: 'user-b',
    username: 'Bob',
    content: '你也冷静点',
    rawContent: '你也冷静点',
    timestamp: Date.now() - 2000
  });
  contextService.addUserMessage({
    channelId: 'room-1',
    userId: 'user-a',
    username: 'Alice',
    content: '我只是提醒一下',
    rawContent: '我只是提醒一下',
    timestamp: Date.now() - 1000
  });

  const participantResult = await host.toolRegistry.execute('context.participants.recent', {
    session: {
      userId: 'admin-1',
      username: 'Admin',
      channelId: 'room-1'
    },
    userId: 'admin-1',
    username: 'Admin',
    currentEventId: null,
    contextService,
    conversationStore: contextService,
    sendOptions: {
      botProfile: {
        uid: 'bot-1'
      }
    }
  }, {
    limit: 5,
    messageLimit: 10
  });
  assert.equal(participantResult.ok, true, 'recent participants tool should succeed for admin');
  assert.equal(Array.isArray(participantResult.data?.participants), true, 'recent participants tool should return structured participants');
  assert.equal(participantResult.data.participants[0].userId, 'user-a', 'most active participant should be ranked first');

  const bulkResult = await host.toolRegistry.execute('communication.private.bulk_send', {
    session: {
      userId: 'admin-1',
      username: 'Admin'
    },
    userId: 'admin-1',
    username: 'Admin',
    ctx
  }, {
    userIds: ['user-a', 'user-b', 'user-a'],
    text: '请先冷静一下，不要继续升级冲突。',
    category: 'warning'
  });
  assert.equal(bulkResult.ok, true, 'bulk private messaging should succeed');
  assert.equal(sent.length, 2, 'bulk private messaging should de-duplicate user ids');
  assert.equal(sent[0].channelId, 'private:user-a', 'private send should route to derived private channel');
  assert.equal(sent[1].channelId, 'private:user-b', 'private send should route to second derived private channel');

  const visibleTools = host.triggerTemplateRegistry.resolveTools(host.toolRegistry, 'message.mentioned');
  const visibleSkills = host.resolveVisibleSkills(visibleTools, {
    triggerKind: 'message.mentioned',
    isAdmin: true
  });
  const nonAdminTools = host.filterVisibleTools(visibleTools, {
    isAdmin: false
  });
  const nonAdminSkills = host.resolveVisibleSkills(nonAdminTools, {
    triggerKind: 'message.mentioned',
    isAdmin: false
  });
  const compiled = compileWorkflowPrompt({
    trigger: {
      kind: 'message.mentioned'
    },
    protocolRequest: {
      permission: {
        isAdmin: true,
        isSystemRequest: false
      }
    },
    context: {
      triggerTemplate: host.triggerTemplateRegistry.get('message.mentioned')
    },
    availableTools: visibleTools,
    visibleSkills
  });

  assert.equal(visibleSkills.some(skill => skill.id === 'communication.private-messaging'), true, 'visible skills should include private messaging for admin mention trigger');
  assert.equal(visibleSkills.some(skill => skill.id === 'context.participant-resolution'), true, 'visible skills should include context participant resolution');
  assert.equal(visibleSkills.some(skill => skill.id.startsWith('package.')), false, 'admin mention visible skills should not fall back to package.* placeholders for current core capabilities');
  assert.equal(nonAdminTools.some(tool => tool.name === 'communication.private.send'), false, 'non-admin visible tools should hide admin-only private messaging');
  assert.equal(nonAdminSkills.some(skill => skill.id === 'communication.private-messaging'), false, 'non-admin visible skills should hide admin-only private messaging');
  assert.equal(compiled.prompt.includes('communication.private-messaging'), true, 'compiled workflow prompt should include private messaging skill');
  assert.equal(compiled.prompt.includes('context.participants.recent'), true, 'compiled workflow prompt should include context participant tool');

  console.log('✅ PASS: skills-first workflow framework regression');
}

main().catch((error) => {
  console.error('❌ FAIL: skills-first workflow framework regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
