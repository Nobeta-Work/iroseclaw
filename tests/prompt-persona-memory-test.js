/**
 * Prompt persona memory regression test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const workflowPromptProfilePlugin = require('../src/runtime/plugins/builtins/workflow-prompt-profile');
const promptMemoryPlugin = require('../src/runtime/plugins/builtins/prompt-memory');
const { compileWorkflowPrompt } = require('../src/runtime/workflow/prompt/compiler');
const { createDirectReplyAgent } = require('../src/runtime/direct-reply-agent');
const {
  normalizeConfig
} = require('../src/config/runtime');
const {
  serializePersonaMemoryBlock,
} = require('../src/runtime/prompt-memory/service');

function createPromptFiles(rootDir, promptContent, globalContent = '# IIC\n始终保持自然') {
  const promptDir = path.join(rootDir, 'prompt');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(path.join(promptDir, 'IIC.md'), globalContent, 'utf8');
  fs.writeFileSync(path.join(promptDir, '日常.md'), promptContent, 'utf8');
  return promptDir;
}

function createHost(rootDir, promptDir, memoryConfig = {}) {
  const stateFile = path.join(rootDir, 'workflow-prompt-profile.json');
  const memoryDataDir = path.join(rootDir, 'prompt-memory');
  const host = new PluginHost({
    config: {
      admins: ['admin_uid'],
      workflow: {
        promptProfile: {
          promptDir,
          activePrompt: '日常',
          persist: true,
          stateFile,
          memory: {
            maxEntries: 50,
            dataDir: memoryDataDir,
            ...memoryConfig
          }
        }
      }
    },
    logger: console,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({ policyEngine: new PolicyEngine() }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(workflowPromptProfilePlugin);
  host.registerPlugin(promptMemoryPlugin);
  return {
    host,
    promptProfileService: host.getService('workflow.prompt-profile'),
    promptMemoryService: host.getService('workflow.persona-memory'),
    stateFile,
    memoryDataDir
  };
}

function buildSummaryEntries(nowIso) {
  return [
    {
      id: 'mem_summary_1',
      time: nowIso,
      importance: 8,
      summary: '用户偏好简短直接的回答',
      sourceRoundCount: 20,
      compressedFrom: []
    }
  ];
}

function buildCompressionEntries(nowIso, prefix = 'mem_compress') {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `${prefix}_${index + 1}`,
    time: nowIso,
    importance: 5 - index,
    summary: `压缩后的记忆 ${index + 1}`,
    sourceRoundCount: 10
  }));
}

async function testThresholdGuard() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-memory-threshold-'));
  try {
    const promptDir = createPromptFiles(
      rootDir,
      '# 日常\n你叫小白，回答简短直接。\n## 常态设定\n- 默认使用中文回复'
    );
    const { promptProfileService, promptMemoryService } = createHost(rootDir, promptDir, {
      dataDir: path.join(rootDir, 'prompt-memory')
    });

    const providerCalls = [];
    promptMemoryService.setProvider({
      async complete(input = {}) {
        providerCalls.push(input);
        return {
          ok: true,
          provider: 'mock-memory',
          text: JSON.stringify({ entries: buildSummaryEntries(new Date().toISOString()) })
        };
      }
    });

    const recentTimestamp = Date.now() - (30 * 60 * 1000);
    for (let index = 0; index < 20; index += 1) {
      await promptMemoryService.recordRound({
        promptKey: '日常',
        sourceMode: 'workflow-chat',
        triggerKind: 'message.mentioned',
        sourceScope: 'public',
        channelId: 'room-a',
        userId: 'u1',
        username: 'Tester',
        currentMessage: `@bot round ${index + 1}`,
        replyText: `reply ${index + 1}`,
        timestamp: recentTimestamp + index
      });
    }

    assert.equal(providerCalls.length, 0, 'summary should not trigger before 1h threshold');
    const snapshot = promptProfileService.resolveProfile();
    assert.equal(snapshot.memoryEntries.length, 0, 'prompt file should remain without memory block');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testSummaryRewriteAndPromptReuse() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-memory-summary-'));
  try {
    const promptDir = createPromptFiles(
      rootDir,
      '# 日常\n你叫小白，回答简短直接。\n## 常态设定\n- 默认使用中文回复'
    );
    const { promptProfileService, promptMemoryService } = createHost(rootDir, promptDir, {
      dataDir: path.join(rootDir, 'prompt-memory')
    });

    const summaryEntries = buildSummaryEntries('2026-04-17T10:00:00+08:00');
    const directReplyCalls = [];
    promptMemoryService.setProvider({
      async complete(input = {}) {
        if (typeof input.message === 'string' && input.message.includes('压缩')) {
          return {
            ok: true,
            provider: 'mock-memory',
            text: JSON.stringify({ entries: [] })
          };
        }

        return {
          ok: true,
          provider: 'mock-memory',
          text: JSON.stringify({ entries: summaryEntries })
        };
      }
    });

    const oldTimestamp = Date.now() - (2 * 60 * 60 * 1000);
    for (let index = 0; index < 20; index += 1) {
      await promptMemoryService.recordRound({
        promptKey: '日常',
        sourceMode: 'workflow-chat',
        triggerKind: 'message.mentioned',
        sourceScope: 'public',
        channelId: 'room-a',
        userId: 'u1',
        username: 'Tester',
        currentMessage: `@bot round ${index + 1}`,
        replyText: `reply ${index + 1}`,
        timestamp: oldTimestamp + index
      });
    }

    const snapshot = promptProfileService.resolveProfile();
    assert.equal(snapshot.memoryEntries.length, 1, 'summary should be written back to prompt file');
    assert.equal(snapshot.memoryEntries[0].summary, '用户偏好简短直接的回答', 'summary content should survive round-trip');
    assert.equal(snapshot.memoryEntries[0].sourceRoundCount, 20, 'source round count should be preserved');
    assert.ok(snapshot.memoryText.includes('<<<IIC_PERSONA_MEMORY'), 'memory block should be exposed by prompt profile');

    const compiled = compileWorkflowPrompt({
      trigger: { kind: 'message.mentioned' },
      protocolRequest: {
        permission: {
          isAdmin: false,
          isSystemRequest: false
        }
      }
    }, {
      promptProfileService,
      meme: {
        enabled: false,
        requestEmotionTag: false
      }
    });

    assert.ok(compiled.prompt.includes('<<<IIC_PERSONA_MEMORY'), 'workflow prompt should include memory block');
    assert.ok(compiled.prompt.includes('用户偏好简短直接的回答'), 'workflow prompt should include rewritten memory content');

    const directReplyAgent = createDirectReplyAgent({
      provider: {
        async complete(input = {}) {
          directReplyCalls.push(input.message || '');
          return {
            ok: true,
            provider: 'mock-direct-reply',
            text: '```js\nconsole.log("hello")\n```'
          };
        }
      },
      logger: console,
      config: {
        timeoutMs: 30000,
        promptProfileService
      }
    });

    const reply = await directReplyAgent.generateReply({
      trigger: {
        payload: {
          content: '请用 markdown 给我一段 js 示例'
        }
      },
      protocolRequest: {
        message: {
          content: '请用 markdown 给我一段 js 示例'
        },
        context: {}
      }
    });

    assert.equal(reply.ok, true, 'direct reply agent should still work after memory rewrite');
    assert.ok(directReplyCalls[0].includes('<<<IIC_PERSONA_MEMORY'), 'direct reply prompt should include memory block');

    const promptFile = fs.readFileSync(path.join(promptDir, '日常.md'), 'utf8');
    assert.ok(promptFile.includes('<<<IIC_PERSONA_MEMORY'), 'prompt file should contain memory block');
    assert.equal((promptFile.match(/<<<IIC_PERSONA_MEMORY/g) || []).length, 1, 'prompt file should only contain one memory block');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testCompressionLoop() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-memory-compress-'));
  try {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      id: `mem_seed_${String(index + 1).padStart(2, '0')}`,
      time: new Date(Date.UTC(2026, 3, 17, 0, 0, index)).toISOString(),
      importance: (index % 10) + 1,
      summary: `历史记忆 ${index + 1}`,
      sourceRoundCount: index < 20 ? 20 : 5,
      compressedFrom: []
    }));
    const promptDir = createPromptFiles(
      rootDir,
      '# 日常\n你叫小白，回答简短直接。\n## 长期记忆\n\n' + serializePersonaMemoryBlock(entries)
    );
    const { promptProfileService, promptMemoryService } = createHost(rootDir, promptDir, {
      dataDir: path.join(rootDir, 'prompt-memory')
    });

    const providerCalls = [];
    promptMemoryService.setProvider({
      async complete(input = {}) {
        providerCalls.push(input.message || '');
        const callIndex = providerCalls.length;
        return {
          ok: true,
          provider: 'mock-compress',
          text: JSON.stringify({
            entries: buildCompressionEntries('2026-04-17T11:00:00+08:00', `mem_compress_${callIndex}`)
          })
        };
      }
    });

    const result = await promptMemoryService.compressIfNeeded({
      promptKey: '日常'
    });

    assert.equal(result.ok, true, 'compression should finish successfully');
    assert.ok(providerCalls.length >= 2, 'compression should repeat until maxEntries is satisfied');
    const snapshot = promptProfileService.resolveProfile();
    assert.equal(snapshot.memoryEntries.length, 50, 'compressed memory should be trimmed to maxEntries');
    assert.ok(snapshot.memoryEntries.some(entry => Array.isArray(entry.compressedFrom) && entry.compressedFrom.length === 10), 'compressed entries should preserve source ids');
    const blockCount = (fs.readFileSync(path.join(promptDir, '日常.md'), 'utf8').match(/<<<IIC_PERSONA_MEMORY/g) || []).length;
    assert.equal(blockCount, 1, 'prompt file should still contain only one memory block after compression');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testRuntimeConfigDefaults() {
  const normalized = normalizeConfig({});
  assert.equal(normalized.workflow.promptProfile.memory.maxEntries, 50, 'default maxEntries should be 50');

  const overridden = normalizeConfig({
    workflow: {
      promptProfile: {
        memory: {
          maxEntries: 0
        }
      }
    }
  });
  assert.equal(overridden.workflow.promptProfile.memory.maxEntries, 1, 'maxEntries should be clamped to at least 1');
}

async function main() {
  await testRuntimeConfigDefaults();
  await testThresholdGuard();
  await testSummaryRewriteAndPromptReuse();
  await testCompressionLoop();
  console.log('✅ PASS: prompt persona memory regression');
}

main().catch((error) => {
  console.error('❌ FAIL: prompt persona memory regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
