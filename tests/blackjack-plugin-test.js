/**
 * Blackjack runtime plugin regression test
 */

const assert = require('assert');
const { PluginHost } = require('../src/runtime/plugins/host');
const { ToolRegistry } = require('../src/tools/registry');
const { TriggerTemplateRegistry } = require('../src/runtime/trigger/template-registry');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { createIiroseMarkdownOutputPlugin } = require('../src/runtime/output/plugins/iirose-markdown-output');
const blackjackPlugin = require('../src/runtime/plugins/games/blackjack');

function createHost(options = {}) {
  const listeners = new Map();
  const sent = [];
  const failPrivateUids = new Set(options.failPrivateUids || []);

  const ctx = {
    on(eventName, callback) {
      listeners.set(eventName, callback);
      return () => listeners.delete(eventName);
    }
  };

  const bot = {
    async sendMessage(channelId, text) {
      sent.push({
        kind: 'message.route',
        target: {
          scope: channelId.startsWith('private:') ? 'private' : 'channel',
          channelId,
          userId: channelId.startsWith('private:') ? channelId.slice('private:'.length) : ''
        },
        text
      });
      const privateUid = channelId.startsWith('private:')
        ? channelId.slice('private:'.length)
        : '';
      if (privateUid && failPrivateUids.has(privateUid)) {
        throw new Error(`private blocked: ${privateUid}`);
      }
      return {};
    }
  };

  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push({
        kind: operation.kind,
        target: operation.target || {},
        text: operation.content?.text || ''
      });
      return {};
    }
  });
  outputRuntime.registerPlugin(createIiroseMarkdownOutputPlugin());

  const host = new PluginHost({
    config: {
      bot: {
        uid: 'bot-1',
        name: 'TestBot'
      },
      admins: ['admin-1'],
      pluginConfigs: {
        'games-blackjack': {
          persist: false,
          joinWindowMs: 0,
          turnTimeoutMs: 60 * 1000,
          deckFactory: options.deckFactory,
          shuffle: options.shuffle || ((deck) => deck)
        }
      }
    },
    logger: console,
    ctx,
    toolRegistry: new ToolRegistry(),
    outputRuntime,
    policyEngine: new PolicyEngine(),
    triggerTemplateRegistry: new TriggerTemplateRegistry()
  });

  host.registerPlugin(blackjackPlugin);
  return { host, listeners, sent, bot };
}

function countOperations(sent, kind) {
  return sent.filter(item => item.kind === kind);
}

async function testSinglePlayerBustFlow() {
  const { host, listeners, sent, bot } = createHost({
    deckFactory: () => [
      { rank: '10', suit: '♠' },
      { rank: '6', suit: '♦' },
      { rank: '8', suit: '♥' },
      { rank: '9', suit: '♣' },
      { rank: '5', suit: '♠' },
      { rank: '2', suit: '♦' }
    ]
  });

  const dealer = {
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '',
    bot
  };

  const rulesResult = await host.toolRegistry.execute('games.blackjack.rules', {
    session: dealer
  }, {});
  assert.equal(rulesResult.ok, true, 'rules tool should return ok');
  assert.equal(rulesResult.result.includes('开局者为庄家'), true, 'rules should mention host as dealer');
  assert.equal(host.toolRegistry.matchMessage('21点规则')?.name, 'games.blackjack.rules', 'rules phrase should route to rules tool');

  const openResult = await host.toolRegistry.execute('games.blackjack.start', {
    session: dealer
  }, {});
  assert.equal(openResult.ok, true, 'start tool should return ok');
  assert.equal(openResult.result.includes('Alice 为庄家'), true, 'start should identify the opener as dealer');
  assert.equal(openResult.result.includes('30 秒'), false, 'start should not advertise a join timeout');

  const onMessage = listeners.get('message');
  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-solo',
    content: '加入',
    bot
  });

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '加入',
    bot
  });

  const joinReplies = countOperations(sent, 'reply.current');
  assert.equal(joinReplies[1].text.includes('庄家已经在当前对局中'), true, 'dealer should not be able to join as a player');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '开始21点',
    bot
  });

  const privateOpsAfterBegin = countOperations(sent, 'message.route');
  const roomOpsAfterBegin = countOperations(sent, 'reply.current');
  assert.equal(privateOpsAfterBegin.length, 2, 'begin should private-message the dealer and the joined player');
  assert.equal(privateOpsAfterBegin[0].text.startsWith('\\\\\\*\n#### 21点\n```markdown\n'), true, 'dealer private message should include blackjack markdown wrapper');
  assert.equal(privateOpsAfterBegin[0].target.channelId, 'private:dealer-a', 'dealer should receive a private hand message');
  assert.equal(privateOpsAfterBegin[0].text.includes('你的庄家手牌：6♦ 9♣ = 15'), true, 'dealer private delivery should include full dealer hand');
  assert.equal(privateOpsAfterBegin[0].text.includes('不到 17 点'), true, 'dealer private delivery should explain the forced-hit rule');
  assert.equal(privateOpsAfterBegin[1].target.channelId, 'private:user-b', 'private delivery should target the player');
  assert.equal(privateOpsAfterBegin[1].text.includes('你的手牌：10♠ 8♥ = 18'), true, 'player private delivery should include opening hand');
  assert.equal(roomOpsAfterBegin[2].text.startsWith('\\\\\\*\n#### 21点\n```markdown\n'), true, 'room reply should include blackjack markdown wrapper');
  assert.equal(roomOpsAfterBegin[2].text.includes('Alice 明牌：6♦ 暗牌'), true, 'room reply should show the dealer identity and upcard');
  assert.equal(roomOpsAfterBegin[2].text.includes('当前玩家： [*Bob*] '), true, 'first turn should use rose mention format');
  assert.equal(roomOpsAfterBegin[2].text.includes('剩余操作时间'), false, 'turn prompt should not mention timeout');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-solo',
    content: '要牌',
    bot
  });

  const privateOpsAfterHit = countOperations(sent, 'message.route');
  const roomOpsAfterHit = countOperations(sent, 'reply.current');
  assert.equal(privateOpsAfterHit.length, 3, 'player hit should send one more private update');
  assert.equal(privateOpsAfterHit[2].text.includes('你抽到：5♠'), true, 'player private update should include drawn card');
  assert.equal(roomOpsAfterHit[3].text.includes('Bob 爆牌。'), true, 'public reply should announce bust immediately');
  assert.equal(roomOpsAfterHit[3].text.includes('Bob：已行动'), false, 'public reply should not expose hidden end-state labels before settlement');
  assert.equal(roomOpsAfterHit[3].text.includes('Alice 进入庄家回合'), true, 'single-player bust should advance to dealer turn first');
  assert.equal(roomOpsAfterHit[3].text.includes('本局 21 点结算'), false, 'dealer should decide manually instead of auto-settling');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '停牌',
    bot
  });
  const roomOpsAfterBadStand = countOperations(sent, 'reply.current');
  assert.equal(roomOpsAfterBadStand[4].text.includes('不到 17 点'), true, 'dealer should not be allowed to stand below 17');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '要牌',
    bot
  });
  const privateOpsAfterDealerHit = countOperations(sent, 'message.route');
  const roomOpsAfterDealerHit = countOperations(sent, 'reply.current');
  assert.equal(privateOpsAfterDealerHit.length, 4, 'dealer hit should send a new dealer private update');
  assert.equal(privateOpsAfterDealerHit[3].target.channelId, 'private:dealer-a', 'dealer hit should private-message the dealer');
  assert.equal(privateOpsAfterDealerHit[3].text.includes('你抽到：2♦'), true, 'dealer private update should include drawn card');
  assert.equal(roomOpsAfterDealerHit[5].text.includes('Alice 选择要牌'), true, 'dealer hit should be acknowledged publicly');
  assert.equal(roomOpsAfterDealerHit[5].text.includes('当前玩家： [*Alice*] '), true, 'dealer should remain current after a normal hit');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-solo',
    content: '停牌',
    bot
  });
  const roomOpsAfterDealerStand = countOperations(sent, 'reply.current');
  assert.equal(roomOpsAfterDealerStand[6].text.includes('本局 21 点结算'), true, 'dealer stand should finally settle the round');
  assert.equal(roomOpsAfterDealerStand[6].text.includes('Alice：6♦ 9♣ 2♦ = 17'), true, 'dealer settlement should use the opener name');
  assert.equal(roomOpsAfterDealerStand[6].text.includes('Bob：10♠ 8♥ 5♠ = 23（爆牌）'), true, 'settlement should reveal the bust result');

  const statusResult = await host.toolRegistry.execute('games.blackjack.status', {
    session: dealer
  }, {});
  assert.equal(statusResult.result.includes('当前没有进行中的21点对局'), true, 'settled game should be cleaned up');

  host.dispose();
  assert.equal(listeners.has('message'), false, 'listener should be cleaned up on dispose');
}

async function testExitCancelsGameForAnyMember() {
  const { host, listeners, sent, bot } = createHost({
    deckFactory: () => [
      { rank: '10', suit: '♠' },
      { rank: '6', suit: '♦' },
      { rank: '8', suit: '♥' },
      { rank: '9', suit: '♣' }
    ]
  });

  const onMessage = listeners.get('message');
  const dealer = {
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-exit',
    content: '',
    bot
  };

  await host.toolRegistry.execute('games.blackjack.start', {
    session: dealer
  }, {});

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-exit',
    content: '加入',
    bot
  });

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-exit',
    content: '退出',
    bot
  });

  const roomReplies = countOperations(sent, 'reply.current');
  assert.equal(roomReplies[1].text.includes('Bob 已通过“退出”结束当前21点对局'), true, 'any member should be able to end the current game with exit');

  const statusResult = await host.toolRegistry.execute('games.blackjack.status', {
    session: dealer
  }, {});
  assert.equal(statusResult.result.includes('当前没有进行中的21点对局'), true, 'exit should fully clear the current game');

  host.dispose();
}

async function testRoundRobinTurnsAndPrivateFallback() {
  const { host, listeners, sent, bot } = createHost({
    failPrivateUids: ['user-c'],
    deckFactory: () => [
      { rank: '10', suit: '♠' },
      { rank: '9', suit: '♠' },
      { rank: '6', suit: '♦' },
      { rank: '4', suit: '♥' },
      { rank: '7', suit: '♣' },
      { rank: '9', suit: '♣' },
      { rank: '5', suit: '♦' },
      { rank: '7', suit: '♥' }
    ]
  });

  const onMessage = listeners.get('message');
  const dealer = {
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-round',
    content: '',
    bot
  };

  await host.toolRegistry.execute('games.blackjack.start', {
    session: dealer
  }, {});

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-round',
    content: '加入',
    bot
  });
  await onMessage({
    userId: 'user-c',
    username: 'Cindy',
    channelId: 'room-bj-round',
    content: '加入',
    bot
  });
  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-round',
    content: '开始21点',
    bot
  });

  const roomReplies = countOperations(sent, 'reply.current');
  const privateOps = countOperations(sent, 'message.route');
  assert.equal(privateOps.length, 3, 'begin should attempt private delivery for dealer and both joined players');
  assert.equal(privateOps[0].target.channelId, 'private:dealer-a', 'dealer should receive a private hand message');
  assert.equal(roomReplies[2].text.includes('Cindy 的手牌私聊发送失败'), true, 'begin should downgrade failed private delivery to room warning');
  assert.equal(roomReplies[2].text.includes('当前玩家： [*Bob*] '), true, 'round should start with the first joined player using rose mention format');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-round',
    content: '要牌',
    bot
  });
  const afterBobHit = countOperations(sent, 'reply.current');
  assert.equal(afterBobHit[3].text.includes('Bob 选择要牌'), true, 'Bob hit should be acknowledged');
  assert.equal(afterBobHit[3].text.includes('当前玩家： [*Bob*] '), true, 'a normal hit should keep the same player active');
  assert.equal(afterBobHit[3].text.includes('Bob 爆牌'), false, 'public hit reply should not expose bust state');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-round',
    content: '要牌',
    bot
  });
  const afterDealerWrongTurn = countOperations(sent, 'reply.current');
  assert.equal(afterDealerWrongTurn[4].text.includes('还没轮到你'), true, 'dealer should not act in player turn rotation');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-round',
    content: '停牌',
    bot
  });
  const afterBobStand = countOperations(sent, 'reply.current');
  assert.equal(afterBobStand[5].text.includes('当前玩家： [*Cindy*] '), true, 'only after standing should the turn move to the next player');

  await onMessage({
    userId: 'user-c',
    username: 'Cindy',
    channelId: 'room-bj-round',
    content: '停牌',
    bot
  });
  const afterCindyStand = countOperations(sent, 'reply.current');
  assert.equal(afterCindyStand[6].text.includes('Cindy 选择停牌'), true, 'Cindy stand should be acknowledged');
  assert.equal(afterCindyStand[6].text.includes('Alice 进入庄家回合'), true, 'after all players finish, the dealer should get a manual turn');
  assert.equal(afterCindyStand[6].text.includes('当前玩家： [*Alice*] '), true, 'dealer turn prompt should use rose mention format');

  await onMessage({
    userId: 'user-b',
    username: 'Bob',
    channelId: 'room-bj-round',
    content: '要牌',
    bot
  });
  const afterPlayerWrongTurn = countOperations(sent, 'reply.current');
  assert.equal(afterPlayerWrongTurn[7].text.includes('当前轮到庄家 Alice 操作'), true, 'players should not act during the dealer turn');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-round',
    content: '停牌',
    bot
  });
  const afterDealerBadStand = countOperations(sent, 'reply.current');
  assert.equal(afterDealerBadStand[8].text.includes('不到 17 点'), true, 'dealer should still be forced to hit below 17');

  await onMessage({
    userId: 'dealer-a',
    username: 'Alice',
    channelId: 'room-bj-round',
    content: '要牌',
    bot
  });
  const afterDealerHit = countOperations(sent, 'reply.current');
  assert.equal(afterDealerHit[9].text.includes('Alice 选择要牌'), true, 'dealer hit should be acknowledged');
  assert.equal(afterDealerHit[9].text.includes('本局 21 点结算'), true, 'dealer bust should settle immediately');
  assert.equal(afterDealerHit[9].text.includes('Alice：6♦ 9♣ 7♥ = 22（爆牌）'), true, 'dealer settlement should use the opener identity');
  assert.equal(afterDealerHit[9].text.includes('Bob：10♠ 4♥ 5♦ = 19，获胜'), true, 'Bob should win with 19 against busted dealer');
  assert.equal(afterDealerHit[9].text.includes('Cindy：9♠ 7♣ = 16，获胜'), true, 'Cindy should win after standing');

  const statusResult = await host.toolRegistry.execute('games.blackjack.status', {
    session: dealer
  }, {});
  assert.equal(statusResult.result.includes('当前没有进行中的21点对局'), true, 'settled round-robin game should be cleaned up');

  host.dispose();
}

async function main() {
  await testSinglePlayerBustFlow();
  await testExitCancelsGameForAnyMember();
  await testRoundRobinTurnsAndPrivateFallback();
  console.log('✅ PASS: blackjack plugin regression');
}

main().catch((error) => {
  console.error('❌ FAIL: blackjack plugin regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
