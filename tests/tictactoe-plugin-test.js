/**
 * TicTacToe runtime plugin regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const tictactoePlugin = require('../src/runtime/plugins/games/tictactoe');

function createHost() {
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
        'games-tictactoe': {
          persist: false,
          allowPrivate: true
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

  host.registerPlugin(tictactoePlugin);
  return { host, listeners, sent };
}

async function testSoloMode() {
  const { host, listeners, sent } = createHost();

  assert.equal(host.toolRegistry.has('games.tictactoe.start'), true, 'start tool should be registered');
  assert.equal(host.toolRegistry.has('games.tictactoe.join'), true, 'join tool should be registered');
  assert.equal(host.toolRegistry.has('games.tictactoe.status'), true, 'status tool should be registered');
  assert.equal(host.toolRegistry.has('games.tictactoe.rules'), true, 'rules tool should be registered');
  assert.equal(host.toolRegistry.has('games.tictactoe.restart'), true, 'restart tool should be registered');
  assert.equal(host.toolRegistry.has('games.tictactoe.quit'), true, 'quit tool should be registered');
  assert.equal(typeof listeners.get('message'), 'function', 'plugin should register quick input listener');

  const session = {
    userId: 'user-1',
    username: 'Alice',
    channelId: 'room-solo',
    content: '',
    bot: {}
  };

  const rulesResult = await host.toolRegistry.execute('games.tictactoe.rules', {
    session
  }, {});
  assert.equal(rulesResult.ok, true, 'rules tool should return ok');
  assert.equal(rulesResult.result.includes('井字棋规则'), true, 'rules tool should render rules text');
  assert.equal(rulesResult.result.includes('单人模式'), true, 'rules should include solo mode');
  assert.equal(rulesResult.result.includes('双人模式'), true, 'rules should include duo mode');
  const rulesMatch = host.toolRegistry.matchMessage('井字棋 规则');
  assert.equal(rulesMatch?.name, 'games.tictactoe.rules', 'rules phrase should route to rules tool');

  const openResult = await host.toolRegistry.execute('games.tictactoe.start', {
    session
  }, {});

  assert.equal(openResult.ok, true, 'start tool should return ok');
  assert.equal(openResult.result.includes('井字棋'), true, 'start tool should render board');
  assert.equal(openResult.result.includes('直接发送数字 1-9'), true, 'solo mode should advertise quick input');

  const onMessage = listeners.get('message');
  await onMessage({
    userId: 'user-1',
    username: 'Alice',
    channelId: 'room-solo',
    content: '5'
  });

  assert.equal(sent.length, 1, 'solo quick input should emit one reply');
  assert.equal(sent[0].includes('X'), true, 'solo reply should contain player mark');
  assert.equal(sent[0].includes('O'), true, 'solo reply should contain bot mark');
  assert.equal(sent[0].includes('最近一步'), true, 'solo reply should describe latest move');

  await onMessage({
    userId: 'user-2',
    username: 'Bob',
    channelId: 'room-solo',
    content: '1'
  });

  assert.equal(sent.length, 1, 'other users should not hijack solo game');

  const quitResult = await host.toolRegistry.execute('games.tictactoe.quit', {
    session
  }, {});
  assert.equal(quitResult.ok, true, 'solo quit should return ok');
  assert.equal(quitResult.result.includes('已结束'), true, 'solo quit should confirm shutdown');

  host.dispose();
  assert.equal(listeners.has('message'), false, 'solo listener should be cleaned up on dispose');
}

async function testDuoMode() {
  const { host, listeners, sent } = createHost();
  const onMessage = listeners.get('message');

  const alice = {
    userId: 'user-x',
    username: 'Alice',
    channelId: 'room-duo',
    content: '',
    bot: {}
  };
  const bob = {
    userId: 'user-o',
    username: 'Bob',
    channelId: 'room-duo',
    content: '',
    bot: {}
  };

  const openResult = await host.toolRegistry.execute('games.tictactoe.start', {
    session: alice
  }, {
    query: '双人'
  });

  assert.equal(openResult.ok, true, 'duo start should return ok');
  assert.equal(openResult.result.includes('井字棋（双人）'), true, 'duo start should show mode');
  assert.equal(openResult.result.includes('等待第二位玩家加入'), true, 'duo start should show waiting state');

  await onMessage({
    userId: 'user-o',
    username: 'Bob',
    channelId: 'room-duo',
    content: '加入'
  });

  assert.equal(sent.length, 1, 'join quick input should emit one reply');
  assert.equal(sent[0].includes('X: Alice'), true, 'join reply should include X player');
  assert.equal(sent[0].includes('O: Bob'), true, 'join reply should include O player');
  assert.equal(sent[0].includes('轮到 Alice（X）'), true, 'duo join should start with X turn');

  await onMessage({
    userId: 'user-o',
    username: 'Bob',
    channelId: 'room-duo',
    content: '5'
  });

  assert.equal(sent.length, 2, 'out-of-turn move should still reply with validation');
  assert.equal(sent[1].includes('还没轮到你'), true, 'duo mode should reject out-of-turn move');

  await onMessage({
    userId: 'user-x',
    username: 'Alice',
    channelId: 'room-duo',
    content: '1'
  });

  assert.equal(sent.length, 3, 'X move should emit one reply');
  assert.equal(sent[2].includes('轮到 Bob（O）'), true, 'after X move it should be O turn');

  await onMessage({
    userId: 'user-o',
    username: 'Bob',
    channelId: 'room-duo',
    content: '5'
  });

  assert.equal(sent.length, 4, 'O move should emit one reply');
  assert.equal(sent[3].includes('轮到 Alice（X）'), true, 'after O move it should be X turn');
  assert.equal(sent[3].includes('最近一步：Bob（O）'), true, 'duo reply should describe O move');

  const statusResult = await host.toolRegistry.execute('games.tictactoe.status', {
    session: alice
  }, {});
  assert.equal(statusResult.ok, true, 'duo status should return ok');
  assert.equal(statusResult.result.includes('井字棋（双人）'), true, 'duo status should render current board');

  const restartResult = await host.toolRegistry.execute('games.tictactoe.restart', {
    session: bob
  }, {});
  assert.equal(restartResult.ok, true, 'participant should be able to restart duo game');
  assert.equal(restartResult.result.includes('轮到 Alice（X）'), true, 'duo restart should reset turn to X');
  assert.equal(restartResult.result.includes('最近一步'), false, 'duo restart should clear last move');

  const quitResult = await host.toolRegistry.execute('games.tictactoe.quit', {
    session: bob
  }, {});
  assert.equal(quitResult.ok, true, 'duo quit should return ok');
  assert.equal(quitResult.result.includes('Bob 已退出'), true, 'duo quit should mention quitter');

  const emptyStatus = await host.toolRegistry.execute('games.tictactoe.status', {
    session: alice
  }, {});
  assert.equal(emptyStatus.result.includes('当前没有进行中的井字棋'), true, 'status should show empty state after duo quit');

  host.dispose();
  assert.equal(listeners.has('message'), false, 'duo listener should be cleaned up on dispose');
}

async function main() {
  await testSoloMode();
  await testDuoMode();
  console.log('✅ PASS: tictactoe plugin regression');
}

main().catch((error) => {
  console.error('❌ FAIL: tictactoe plugin regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
