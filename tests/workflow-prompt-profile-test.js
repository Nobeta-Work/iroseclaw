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
  const stateFile = path.join('data', 'runtime', `workflow-prompt-profile-test-${Date.now()}.json`);
  const host = new PluginHost({
    config: {
      admins: ['admin_uid'],
      workflow: {
        promptProfile: {
          activeStyle: 'plain',
          persist: true,
          stateFile,
          botProfile: {
            name: 'TestBot',
            identity: '测试机器人',
            extraInstruction: '优先简洁输出'
          },
          styles: {
            plain: {
              label: '平淡',
              instruction: '平淡语气',
              aliases: ['平淡', 'plain']
            },
            warm: {
              label: '热情',
              instruction: '热情语气',
              aliases: ['热情', 'warm']
            },
            affectionate: {
              label: '爱慕',
              instruction: '爱慕语气',
              aliases: ['爱慕', 'affectionate']
            }
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
  assert.equal(Boolean(setTool), true, 'plugin should register style set tool');
  assert.equal(Boolean(statusTool), true, 'plugin should register style status tool');

  const denied = await setTool.execute({
    session: {
      userId: 'normal_uid',
      content: '切换风格 热情'
    }
  }, {
    query: '热情'
  });
  assert.equal(denied.ok, false, 'non-admin should be denied');

  const switched = await setTool.execute({
    session: {
      userId: 'admin_uid',
      content: '切换风格 热情'
    }
  }, {
    query: '热情'
  });
  assert.equal(switched.ok, true, 'admin should be able to switch style');
  assert.equal(service.getActiveStyle(), 'warm', 'service should switch to warm style');

  const status = await statusTool.execute({
    session: {
      userId: 'admin_uid'
    }
  }, {});
  assert.equal(status.ok, true, 'admin should read status');
  assert.equal(String(status.result).includes('热情'), true, 'status should include active style label');

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

  assert.equal(compiled.prompt.includes('当前回复风格: 热情'), true, 'prompt should reflect runtime-selected style');
  assert.equal(compiled.prompt.includes('身份: 测试机器人'), true, 'prompt should include configured bot identity');
  assert.equal(compiled.prompt.includes('额外要求: 优先简洁输出'), true, 'prompt should include extra instruction');

  if (fs.existsSync(path.resolve(process.cwd(), stateFile))) {
    fs.unlinkSync(path.resolve(process.cwd(), stateFile));
  }

  console.log('✅ PASS: workflow prompt profile regression');
}

main().catch((error) => {
  console.error('❌ FAIL: workflow prompt profile regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
