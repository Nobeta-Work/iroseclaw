/**
 * Gomoku runtime plugin regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const gomokuPlugin = require('../src/runtime/plugins/games/gomoku');

function createClock(initial = 1700000000000) {
  let current = initial;
  return {
    now() {
      return current;
    },
    set(value) {
      current = Number(value);
    },
    advance(delta) {
      current += Number(delta);
    }
  };
}

function createHost(pluginConfig = {}) {
  const listeners = new Map();
  const sent = [];

  const ctx = {
    on(eventName, callback) {
      listeners.set(eventName, callback);
      return () => listeners.delete(eventName);
    }
  };

  const host = new PluginHost({
    config: {
      bot: {
        uid: 'bot-1',
        name: 'TestBot'
      },
      pluginConfigs: {
        'games-gomoku': {
          persist: false,
          allowPrivate: true,
          ...pluginConfig
        }
      }
    },
    logger: console,
    ctx,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({
      policyEngine: new PolicyEngine(),
      sender: async (operation) => {
        sent.push(operation.content.text);
        return {};
      }
    }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(gomokuPlugin);
  return { host, listeners, sent };
}

async function testLifecycleAndRendering() {
  const clock = createClock();
  const { host, listeners, sent } = createHost({
    now: () => clock.now(),
    autoCleanupMs: 10 * 60 * 60 * 1000
  });

  assert.equal(host.toolRegistry.has('games.gomoku.start'), true, 'start tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.join'), true, 'join tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.status'), true, 'status tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.rules'), true, 'rules tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.undo'), true, 'undo tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.approve_undo'), true, 'approve undo tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.restart'), true, 'restart tool should be registered');
  assert.equal(host.toolRegistry.has('games.gomoku.quit'), true, 'quit tool should be registered');
  assert.equal(typeof listeners.get('message'), 'function', 'plugin should register quick input listener');

  const alice = {
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku',
    content: '',
    bot: {}
  };

  const rulesResult = await host.toolRegistry.execute('games.gomoku.rules', {
    session: alice
  }, {});
  assert.equal(rulesResult.ok, true, 'rules tool should return ok');
  assert.equal(rulesResult.result.includes('五子棋规则'), true, 'rules should render rules text');
  assert.equal(rulesResult.result.includes('1-13'), true, 'rules should mention one-based columns');
  assert.equal(rulesResult.result.includes('M13'), true, 'rules should mention 13th column example');
  assert.equal(rulesResult.result.includes('悔棋'), true, 'rules should mention undo');
  assert.equal(rulesResult.result.includes('同意'), true, 'rules should mention approval');
  const rulesMatch = host.toolRegistry.matchMessage('五子棋 规则');
  assert.equal(rulesMatch?.name, 'games.gomoku.rules', 'rules phrase should route to rules tool');

  const openResult = await host.toolRegistry.execute('games.gomoku.start', {
    session: alice
  }, {});
  assert.equal(openResult.ok, true, 'start tool should return ok');
  assert.equal(openResult.result.includes('五子棋（双人）'), true, 'start tool should render title');
  assert.equal(openResult.result.includes('等待第二位玩家加入'), true, 'start should show waiting state');
  assert.equal(openResult.result.includes('ps：10后面的是[11]、[12]、[13]'), true, 'start should render header note');
  assert.equal(openResult.result.includes('1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟1️⃣2️⃣3️⃣'), true, 'start should render new header');
  assert.equal(openResult.result.includes('⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜A'), true, 'start should render row A');
  assert.equal(openResult.result.includes('⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜M'), true, 'start should render row M');
  assert.equal(openResult.result.includes('注：手机端点击右下角/不适用夸克浏览器'), true, 'start should render footer note');
  assert.equal(openResult.result.includes('黑方用时：00:00'), true, 'start should render black timer');
  assert.equal(openResult.result.includes('白方用时：00:00'), true, 'start should render white timer');

  clock.advance(1000);
  const onMessage = listeners.get('message');
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku',
    content: '加入'
  });

  assert.equal(sent.length, 1, 'join quick input should emit one reply');
  assert.equal(sent[0].includes('黑: Alice'), true, 'join reply should include black player');
  assert.equal(sent[0].includes('白: Bob'), true, 'join reply should include white player');
  assert.equal(sent[0].includes('轮到 Alice（黑🟥）'), true, 'join should start with black turn');
  assert.equal(sent[0].includes('当前手计时：Alice（黑🟥） 00:00'), true, 'join should start turn timer');

  clock.advance(1000);
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku',
    content: 'd5'
  });

  assert.equal(sent.length, 2, 'out-of-turn move should emit validation reply');
  assert.equal(sent[1].includes('还没轮到你'), true, 'white should be blocked before black moves');

  clock.advance(64000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku',
    content: '5d'
  });

  assert.equal(sent.length, 3, 'valid move should emit one reply');
  assert.equal(sent[2].includes('最近一步：Alice（黑🟥） 用时 01:05，下在 D5'), true, 'move reply should include move duration');
  assert.equal(sent[2].includes('轮到 Bob（白🟪）'), true, 'turn should switch after valid move');
  assert.equal(sent[2].includes('黑方用时：01:05'), true, 'move reply should update black total');
  assert.equal(sent[2].includes('白方用时：00:00'), true, 'move reply should keep white total');
  assert.equal(sent[2].includes('当前手计时：Bob（白🟪） 00:00'), true, 'move reply should restart timer for next turn');

  clock.advance(3000);
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku',
    content: 'D5'
  });

  assert.equal(sent.length, 4, 'occupied move should emit validation reply');
  assert.equal(sent[3].includes('位置 D5 已经被占了'), true, 'occupied coordinate should be rejected');

  const statusResult = await host.toolRegistry.execute('games.gomoku.status', {
    session: alice
  }, {});
  assert.equal(statusResult.ok, true, 'status tool should return ok');
  assert.equal(statusResult.result.includes('最近一步：Alice（黑🟥） 用时 01:05，下在 D5'), true, 'status should include latest move');
  assert.equal(statusResult.result.includes('注：手机端点击右下角/不适用夸克浏览器'), true, 'status should include footer note');
  assert.equal(statusResult.result.includes('黑方用时：01:05'), true, 'status should include black total');
  assert.equal(statusResult.result.includes('当前手计时：Bob（白🟪） 00:03'), true, 'status should show current turn elapsed');

  clock.advance(2000);
  const restartResult = await host.toolRegistry.execute('games.gomoku.restart', {
    session: {
      userId: 'user-white',
      username: 'Bob',
      channelId: 'room-gomoku',
      content: '',
      bot: {}
    }
  }, {});
  assert.equal(restartResult.ok, true, 'participant should be able to restart');
  assert.equal(restartResult.result.includes('轮到 Alice（黑🟥）'), true, 'restart should reset turn to black');
  assert.equal(restartResult.result.includes('最近一步'), false, 'restart should clear last move');
  assert.equal(restartResult.result.includes('黑方用时：00:00'), true, 'restart should reset black total');
  assert.equal(restartResult.result.includes('白方用时：00:00'), true, 'restart should reset white total');
  assert.equal(restartResult.result.includes('当前手计时：Alice（黑🟥） 00:00'), true, 'restart should restart black timer');

  const quitResult = await host.toolRegistry.execute('games.gomoku.quit', {
    session: {
      userId: 'user-white',
      username: 'Bob',
      channelId: 'room-gomoku',
      content: '',
      bot: {}
    }
  }, {});
  assert.equal(quitResult.ok, true, 'quit should return ok');
  assert.equal(quitResult.result.includes('Bob 已退出'), true, 'quit should mention quitter');

  const emptyStatus = await host.toolRegistry.execute('games.gomoku.status', {
    session: alice
  }, {});
  assert.equal(emptyStatus.result.includes('当前没有进行中的五子棋'), true, 'status should show empty state after quit');

  host.dispose();
  assert.equal(listeners.has('message'), false, 'listener should be cleaned up on dispose');
}

async function testCoordinateCompatibilityAndWin() {
  const clock = createClock();
  const { host, listeners, sent } = createHost({
    now: () => clock.now()
  });
  const onMessage = listeners.get('message');

  const alice = {
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-win',
    content: '',
    bot: {}
  };

  await host.toolRegistry.execute('games.gomoku.start', {
    session: alice
  }, {});

  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-win',
    content: '加入'
  });

  const moves = [
    ['user-black', 'Alice', '1a'],
    ['user-white', 'Bob', 'b1'],
    ['user-black', 'Alice', 'A2'],
    ['user-white', 'Bob', '2b'],
    ['user-black', 'Alice', 'a3'],
    ['user-white', 'Bob', 'B3'],
    ['user-black', 'Alice', '4A'],
    ['user-white', 'Bob', 'b4'],
    ['user-black', 'Alice', 'A5']
  ];

  for (const [userId, username, content] of moves) {
    clock.advance(1000);
    await onMessage({
      userId,
      username,
      channelId: 'room-gomoku-win',
      content
    });
  }

  const lastReply = sent[sent.length - 1];
  assert.equal(lastReply.includes('Alice 赢了'), true, 'five in a row should end the game');
  assert.equal(lastReply.includes('最近一步：Alice（黑🟥） 用时 00:01，下在 A5'), true, 'winning move should be normalized');

  host.dispose();
}

async function testDoubleDigitAndThirteenCoordinates() {
  const clock = createClock();
  const { host, listeners, sent } = createHost({
    now: () => clock.now()
  });
  const onMessage = listeners.get('message');

  const alice = {
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-double',
    content: '',
    bot: {}
  };

  await host.toolRegistry.execute('games.gomoku.start', {
    session: alice
  }, {});

  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-double',
    content: '加入'
  });

  clock.advance(1000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-double',
    content: '10c'
  });

  assert.equal(sent[sent.length - 1].includes('最近一步：Alice（黑🟥） 用时 00:01，下在 C10'), true, 'should parse col-row double-digit input');

  clock.advance(1000);
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-double',
    content: 'C11'
  });

  assert.equal(sent[sent.length - 1].includes('最近一步：Bob（白🟪） 用时 00:01，下在 C11'), true, 'should parse row-col double-digit input');

  clock.advance(1000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-double',
    content: '13c'
  });

  assert.equal(sent[sent.length - 1].includes('最近一步：Alice（黑🟥） 用时 00:01，下在 C13'), true, 'should parse thirteenth column');

  host.dispose();
}

async function testUndoFlow() {
  const clock = createClock();
  const { host, listeners, sent } = createHost({
    now: () => clock.now()
  });
  const onMessage = listeners.get('message');

  const alice = {
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-undo',
    content: '',
    bot: {}
  };

  await host.toolRegistry.execute('games.gomoku.start', {
    session: alice
  }, {});

  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-undo',
    content: '加入'
  });

  clock.advance(10000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-undo',
    content: 'D5'
  });

  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-undo',
    content: 'E5'
  });

  clock.advance(5000);
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-undo',
    content: '晦气'
  });

  const requestReply = sent[sent.length - 1];
  assert.equal(requestReply.includes('Bob 已发起悔棋申请'), true, 'requester should be able to ask for undo');
  assert.equal(requestReply.includes('悔棋申请：Bob（白🟪）请求撤销 E5'), true, 'board should show pending undo request');
  assert.equal(requestReply.includes('黑方用时：00:10'), true, 'undo request should keep black total');
  assert.equal(requestReply.includes('白方用时：00:00'), true, 'undo request should keep white total');

  clock.advance(5000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-undo',
    content: 'F5'
  });

  const blockedReply = sent[sent.length - 1];
  assert.equal(blockedReply.includes('当前有待处理的悔棋申请'), true, 'moves should be blocked while undo is pending');

  clock.advance(5000);
  await onMessage({
    userId: 'user-black',
    username: 'Alice',
    channelId: 'room-gomoku-undo',
    content: '同意'
  });

  const approveReply = sent[sent.length - 1];
  assert.equal(approveReply.includes('Alice 已同意悔棋，撤销了 E5'), true, 'opponent approval should revoke last move');
  assert.equal(approveReply.includes('轮到 Bob（白🟪）'), true, 'turn should return to the requester');
  assert.equal(approveReply.includes('最近一步：Alice（黑🟥） 用时 00:10，下在 D5'), true, 'last move should roll back to previous move');
  assert.equal(approveReply.includes('黑方用时：00:10'), true, 'approve should keep black total');
  assert.equal(approveReply.includes('白方用时：00:00'), true, 'approve should roll back white total');
  assert.equal(approveReply.includes('当前手计时：Bob（白🟪） 00:00'), true, 'approve should restart requester timer');

  clock.advance(20000);
  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-undo',
    content: 'F5'
  });

  const replayReply = sent[sent.length - 1];
  assert.equal(replayReply.includes('最近一步：Bob（白🟪） 用时 00:20，下在 F5'), true, 'requester should be able to place a new move after undo');
  assert.equal(replayReply.includes('白方用时：00:20'), true, 'replayed move should update white total');

  host.dispose();
}

async function testLongDurationFormatting() {
  const clock = createClock();
  const { host, listeners } = createHost({
    now: () => clock.now(),
    autoCleanupMs: 10 * 60 * 60 * 1000
  });
  const onMessage = listeners.get('message');

  await host.toolRegistry.execute('games.gomoku.start', {
    session: {
      userId: 'user-black',
      username: 'Alice',
      channelId: 'room-gomoku-long',
      content: '',
      bot: {}
    }
  }, {});

  await onMessage({
    userId: 'user-white',
    username: 'Bob',
    channelId: 'room-gomoku-long',
    content: '加入'
  });

  clock.advance((1 * 60 * 60 + 2 * 60 + 3) * 1000);
  const status = await host.toolRegistry.execute('games.gomoku.status', {
    session: {
      userId: 'user-black',
      username: 'Alice',
      channelId: 'room-gomoku-long',
      content: '',
      bot: {}
    }
  }, {});

  assert.equal(status.result.includes('当前手计时：Alice（黑🟥） 01:02:03'), true, 'status should switch to hh:mm:ss after one hour');

  host.dispose();
}

async function main() {
  await testLifecycleAndRendering();
  await testCoordinateCompatibilityAndWin();
  await testDoubleDigitAndThirteenCoordinates();
  await testUndoFlow();
  await testLongDurationFormatting();
  console.log('✅ PASS: gomoku plugin regression');
}

main().catch((error) => {
  console.error('❌ FAIL: gomoku plugin regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
