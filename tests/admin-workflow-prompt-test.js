/**
 * Admin workflow prompt regression test
 */

const assert = require('assert');
const { OpenClawAdapter } = require('../src/adapters/openclaw-adapter');

async function main() {
  const adapter = new OpenClawAdapter({
    subagentLabel: 'test-chat',
    timeout: 5000,
    fallbackResponses: ['fallback']
  });

  const adminPrompt = adapter._buildWorkflowPrompt({
    protocolRequest: {
      session: {
        userId: 'admin_uid',
        username: 'Noβ',
        channelId: 'room-1'
      },
      message: {
        content: '我不是你的管理员吗'
      },
      permission: {
        isAdmin: true,
        isSystemRequest: false,
        allowedSkills: ['chat', 'help', 'music', 'admin', 'system']
      },
      context: {
        triggerUser: {
          id: 'admin_uid',
          name: 'Noβ'
        },
        currentMessage: {
          userId: 'admin_uid',
          username: 'Noβ',
          content: '我不是你的管理员吗'
        }
      }
    },
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: '我不是你的管理员吗'
      }
    },
    availableTools: []
  });

  assert.ok(adminPrompt.includes('当前触发用户拥有管理员权限'), 'workflow prompt should expose admin identity');
  assert.ok(adminPrompt.includes('权限摘要: isAdmin=true'), 'workflow prompt should include admin permission summary');
  assert.ok(adminPrompt.includes('转移到/移动到/移步到/去某房间'), 'workflow prompt should teach natural-language room move intent');
  assert.ok(adminPrompt.includes('房间迁移示例:'), 'workflow prompt should include room move examples');
  assert.ok(adminPrompt.includes('iirose.room.move'), 'workflow prompt should explicitly reference room.move tool');

  const nonAdminPrompt = adapter._buildWorkflowPrompt({
    protocolRequest: {
      session: {
        userId: 'user_uid',
        username: 'User',
        channelId: 'room-1'
      },
      message: {
        content: '你好'
      },
      permission: {
        isAdmin: false,
        isSystemRequest: false,
        allowedSkills: ['chat']
      },
      context: {
        triggerUser: {
          id: 'user_uid',
          name: 'User'
        },
        currentMessage: {
          userId: 'user_uid',
          username: 'User',
          content: '你好'
        }
      }
    },
    trigger: {
      kind: 'message.mentioned',
      payload: {
        content: '你好'
      }
    },
    availableTools: []
  });

  assert.ok(nonAdminPrompt.includes('当前触发用户不是管理员'), 'workflow prompt should expose non-admin identity');
  console.log('✅ PASS: admin workflow prompt regression');
}

main().catch((error) => {
  console.error('❌ FAIL: admin workflow prompt regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
