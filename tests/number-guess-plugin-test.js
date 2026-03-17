/**
 * Number Guess runtime plugin regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const numberGuessPlugin = require('../src/runtime/plugins/games/number-guess');

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
        'games-number-guess': {
          persist: false,
          defaultDigits: 4,
          defaultMaxAttempts: 10,
          allowRepeatDigits: true,
          secretGenerator: (digits) => '4271563890'.slice(0, Number(digits) || 4)
        }
      }
    },
    logger: console,
    ctx,
    toolRegistry: new ToolRegistry(),
    outputRuntime: new OutputRuntime({
      policyEngine: new PolicyEngine(),
      sender: async (operation) => {
        sent.push({
          text: operation.content.text,
          metadata: operation.metadata || {}
        });
        return {};
      }
    }),
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(numberGuessPlugin);
  return { host, listeners, sent };
}

async function testStartAndQuickGuess() {
  const { host, listeners, sent } = createHost();

  assert.equal(host.toolRegistry.has('games.number-guess.start'), true, 'start tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.guess'), true, 'guess tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.mode'), true, 'mode tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.status'), true, 'status tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.rules'), true, 'rules tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.restart'), true, 'restart tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.extend'), true, 'extend tool should be registered');
  assert.equal(host.toolRegistry.has('games.number-guess.quit'), true, 'quit tool should be registered');
  assert.equal(typeof listeners.get('message'), 'function', 'plugin should register quick input listener');

  const alice = {
    userId: 'user-1',
    username: 'Alice',
    channelId: 'room-guess',
    content: '',
    bot: {}
  };

  const modeStatus = await host.toolRegistry.execute('games.number-guess.mode', {
    session: alice
  }, {});
  assert.equal(modeStatus.ok, true, 'mode status should return ok');
  assert.equal(modeStatus.result.includes('可重复数字'), true, 'default mode should be repeat');
  const modeMatch = host.toolRegistry.matchMessage('猜数字 模式 不重复');
  assert.equal(modeMatch?.name, 'games.number-guess.mode', 'mode phrase should route to mode tool');

  const modeSwitch = await host.toolRegistry.execute('games.number-guess.mode', {
    session: alice
  }, { query: '不重复' });
  assert.equal(modeSwitch.ok, true, 'mode switch should return ok');
  assert.equal(modeSwitch.result.includes('不重复数字'), true, 'mode switch should update to unique');

  const openResult = await host.toolRegistry.execute('games.number-guess.start', {
    session: alice
  }, {
    query: '普通 5位 99次'
  });

  assert.equal(openResult.ok, true, 'start tool should return ok');
  assert.equal(openResult.result.includes('猜数字已开始'), true, 'start should render intro');
  assert.equal(openResult.result.includes('normal / 4 位 / 10 次'), true, 'start should use fixed normal digits and unified attempts');
  assert.equal(openResult.result.includes('10 次'), true, 'start should apply max attempt option');
  assert.equal(openResult.result.includes('数字不能重复'), true, 'start should respect unique mode');

  const rulesResult = await host.toolRegistry.execute('games.number-guess.rules', {
    session: alice
  }, {});
  assert.equal(rulesResult.ok, true, 'rules tool should return ok');
  assert.equal(rulesResult.result.includes('猜数字规则'), true, 'rules tool should render rules text');
  assert.equal(rulesResult.result.includes('发送“猜数字 普通”开启，固定 4 位'), true, 'rules should include normal mode start phrase');
  assert.equal(rulesResult.result.includes('发送“猜数字 困难”开启，固定 5 位'), true, 'rules should include hard mode start phrase');
  assert.equal(rulesResult.result.includes('每局基础次数统一为 10 次'), true, 'rules should mention unified attempts');
  assert.equal(rulesResult.result.includes('难度档说明'), true, 'rules should include all difficulty descriptions');
  const rulesMatch = host.toolRegistry.matchMessage('猜数字 规则');
  assert.equal(rulesMatch?.name, 'games.number-guess.rules', 'rules phrase should route to rules tool');

  const onMessage = listeners.get('message');
  await onMessage({
    userId: 'user-1',
    username: 'Alice',
    channelId: 'room-guess',
    content: '1122',
    messageId: 'm-1'
  });
  assert.equal(sent.length, 1, 'first quick guess should reply once');
  assert.equal(sent[0].text.includes('数字不能包含重复位'), true, 'duplicate digits should be blocked in unique mode');
  assert.equal(sent[0].metadata.quoteMessageId, 'm-1', 'quick reply should carry quote metadata');

  await onMessage({
    userId: 'user-2',
    username: 'Bob',
    channelId: 'room-guess',
    content: '42713',
    messageId: 'm-2'
  });
  assert.equal(sent.length, 2, 'second quick guess should reply once');
  assert.equal(sent[1].text.includes('位数字'), true, 'length mismatch should be validated');

  await onMessage({
    userId: 'user-2',
    username: 'Bob',
    channelId: 'room-guess',
    content: '1234',
    messageId: 'm-3'
  });
  assert.equal(sent.length, 3, 'valid quick guess should reply once');
  assert.equal(sent[2].text.includes('Bob 猜 1234'), true, 'guess result should mention user and guess');
  assert.equal(/-> \dA\dB/.test(sent[2].text), true, 'guess result should contain AB outcome');

  host.dispose();
}

async function testDeterministicWinAndManagePermissions() {
  const { host, listeners, sent } = createHost();
  const onMessage = listeners.get('message');

  const alice = {
    userId: 'user-a',
    username: 'Alice',
    channelId: 'room-win',
    content: '',
    bot: {}
  };
  const bob = {
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-win',
    content: '',
    bot: {}
  };

  const opened = await host.toolRegistry.execute('games.number-guess.start', {
    session: alice
  }, { query: '简单' });
  assert.equal(opened.ok, true, 'start should succeed');
  assert.equal(opened.result.includes('easy / 3 位 / 10 次'), true, 'easy should use fixed 3 digits and unified attempts');

  for (let i = 0; i < 10; i += 1) {
    await onMessage({
      userId: 'user-b',
      username: 'Bob',
      channelId: 'room-win',
      content: '111',
      messageId: `m-fail-${i}`
    });
  }
  assert.equal(sent.length, 10, 'ten failed guesses should emit ten replies');
  assert.equal(sent[9].text.includes('已达到最大猜测次数'), true, '10th guess should enter lost state');
  assert.equal(sent[9].text.includes('延长'), true, 'lost reply should advertise extend action');
  assert.equal(sent[9].text.includes('退出'), true, 'lost reply should advertise quit action');
  assert.equal(sent[9].text.includes('答案是'), false, 'lost reply should not leak answer');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-win',
    content: '延长',
    messageId: 'm-extend-1'
  });
  assert.equal(sent.length, 11, 'extend command should emit one reply');
  assert.equal(sent[10].text.includes('续命成功'), true, 'extend should reactivate lost game');
  assert.equal(sent[10].text.includes('当前总次数: 20'), true, 'extend should add ten attempts');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-win',
    content: '427',
    messageId: 'm-win-1'
  });
  assert.equal(sent.length, 12, 'winning guess after extend should emit one reply');
  assert.equal(sent[11].text.includes('恭喜 Bob 猜中答案 427'), true, 'winner text should reveal secret');

  const status = await host.toolRegistry.execute('games.number-guess.status', {
    session: bob
  }, {});
  assert.equal(status.ok, true, 'status should return ok');
  assert.equal(status.result.includes('状态: won'), true, 'status should show final state');

  const bobQuit = await host.toolRegistry.execute('games.number-guess.quit', {
    session: bob
  }, {});
  assert.equal(bobQuit.ok, true, 'quit tool should return ok');
  assert.equal(bobQuit.result.includes('Bob 已结束当前猜数字对局'), true, 'non-host should be allowed to quit');
  assert.equal(bobQuit.result.includes('答案是: 427'), true, 'quit should reveal answer');

  host.dispose();
}

async function main() {
  await testStartAndQuickGuess();
  await testDeterministicWinAndManagePermissions();
  console.log('✅ PASS: number-guess plugin regression');
}

main().catch((error) => {
  console.error('❌ FAIL: number-guess plugin regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
