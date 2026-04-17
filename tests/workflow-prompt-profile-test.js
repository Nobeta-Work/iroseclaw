/**
 * Workflow prompt profile plugin regression test
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const workflowPromptProfilePlugin = require('../src/runtime/plugins/builtins/workflow-prompt-profile');
const { compileWorkflowPrompt } = require('../src/runtime/workflow/prompt/compiler');

async function main() {
  const tempDir = path.join('data', 'runtime', `workflow-prompt-profile-test-${Date.now()}`);
  const stateFile = path.join(tempDir, 'state.json');
  const promptDir = path.join(tempDir, 'prompt');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(path.join(promptDir, 'IIC.md'), '# 全局前置\n始终保持像聊天室真人', 'utf8');
  fs.writeFileSync(path.join(promptDir, '女仆.md'), '# 女仆设定\n你是 Noβ 的女仆', 'utf8');
  fs.writeFileSync(path.join(promptDir, '猫娘.md'), '# 猫娘设定\n你说话会更俏皮一点', 'utf8');

  const host = new PluginHost({
    config: {
      admins: ['admin_uid'],
      workflow: {
        promptProfile: {
          promptDir,
          activePrompt: '女仆',
          persist: true,
          stateFile,
          botProfile: {
            name: 'TestBot'
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
  const service = host.getService('workflow.prompt-profile');
  assert.equal(Boolean(service), true, 'plugin should register prompt profile service');

  const setTool = host.toolRegistry.get('workflow.prompt.style.set');
  const statusTool = host.toolRegistry.get('workflow.prompt.style.status');
  assert.equal(Boolean(setTool), true, 'plugin should register set tool');
  assert.equal(Boolean(statusTool), true, 'plugin should register status tool');

  const denied = await setTool.execute({
    session: {
      userId: 'normal_uid',
      content: '切换提示词 猫娘'
    }
  }, {
    query: '猫娘'
  });
  assert.equal(denied.ok, false, 'non-admin should be denied');

  const switched = await setTool.execute({
    session: {
      userId: 'admin_uid',
      content: '切换提示词 猫娘'
    }
  }, {
    query: '猫娘'
  });
  assert.equal(switched.ok, true, 'admin should be able to switch prompt');
  assert.equal(service.getActivePrompt(), '猫娘', 'service should switch to selected prompt file');

  const status = await statusTool.execute({
    session: {
      userId: 'admin_uid'
    }
  }, {});
  assert.equal(status.ok, true, 'admin should read status');
  assert.equal(String(status.result).includes('IIC'), true, 'status should include global prompt');
  assert.equal(String(status.result).includes('猫娘'), true, 'status should include current prompt');

  const compiled = compileWorkflowPrompt({
    trigger: { kind: 'message.mentioned' },
    protocolRequest: {
      permission: {
        isAdmin: true,
        isSystemRequest: false
      }
    }
  }, {
    promptProfileService: service,
    meme: {
      enabled: false,
      requestEmotionTag: false
    }
  });

  assert.equal(compiled.prompt.includes('当前常态 prompt: 猫娘'), true, 'prompt should reflect runtime-selected prompt');
  assert.equal(compiled.prompt.includes('始终保持像聊天室真人'), true, 'prompt should include global prompt content');
  assert.equal(compiled.prompt.includes('你说话会更俏皮一点'), true, 'prompt should include selected prompt content');

  fs.writeFileSync(path.join(promptDir, '猫娘.md'), '# 猫娘设定\n热更新后的内容', 'utf8');
  const recompiled = compileWorkflowPrompt({
    trigger: { kind: 'message.mentioned' },
    protocolRequest: {
      permission: {
        isAdmin: true,
        isSystemRequest: false
      }
    }
  }, {
    promptProfileService: service,
    meme: {
      enabled: false,
      requestEmotionTag: false
    }
  });
  assert.equal(recompiled.prompt.includes('热更新后的内容'), true, 'prompt compilation should hot reload file content');

  const globalOnly = await setTool.execute({
    session: {
      userId: 'admin_uid',
      content: '切换提示词 IIC'
    }
  }, {
    query: 'IIC'
  });
  assert.equal(globalOnly.ok, false, 'global prompt should not be selectable as active prompt');

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('✅ PASS: workflow prompt profile regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow prompt profile regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
