/**
 * Help overview visibility regression test
 */

const assert = require('assert');
const { renderHelpOverview } = require('../src/services/help/overview');

async function main() {
  const payload = {
    skills: [],
    tools: [
      {
        name: 'music.play_netease',
        sideEffect: true,
        metadata: {
          directMatch: true,
          directAliases: ['点歌'],
          helpVisible: true
        }
      },
      {
        name: 'iirose.room.move',
        sideEffect: true,
        metadata: {
          directMatch: true,
          directAliases: ['切房']
        }
      },
      {
        name: 'proactive.topic.enable',
        sideEffect: true,
        metadata: {
          directMatch: true,
          directAliases: ['开启主动模式'],
          adminOnly: true
        }
      },
      {
        name: 'reply.current',
        sideEffect: true,
        metadata: {
          directMatch: false
        }
      }
    ],
    packages: [
      {
        name: 'games-blackjack-package',
        metadata: {
          pluginName: 'games-blackjack'
        }
      }
    ]
  };

  const help = renderHelpOverview(payload);
  const adminHelp = renderHelpOverview({
    ...payload,
    isAdmin: true
  });

  assert.ok(help.startsWith('## 机器人功能概览\n'), 'help service should return raw markdown body without transport prefix');
  assert.ok(help.includes('点歌 晴天'), 'help should include compact user-facing command');
  assert.ok(help.includes('21点开局'), 'help should expose Blackjack entry in help');
  assert.ok(help.includes('游戏：21点'), 'help should show compact Blackjack game label');
  assert.ok(!help.includes('切房'), 'help should hide operation-oriented side-effect tools by default');
  assert.ok(!help.includes('开启主动模式'), 'help should hide admin-only tools');
  assert.ok(help.includes('管理/运维类内部操作已隐藏'), 'help should clearly explain hidden internal operations');
  assert.ok(adminHelp.includes('管理员快捷'), 'admin help should include admin shortcut section');
  assert.ok(adminHelp.includes('开启主动模式'), 'admin help should expose admin quick commands');
  assert.ok(adminHelp.includes('内部执行细节仍保持隐藏'), 'admin help should still hide internal execution details');

  console.log('✅ PASS: help overview visibility regression');
}

main().catch((error) => {
  console.error('❌ FAIL: help overview visibility regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
