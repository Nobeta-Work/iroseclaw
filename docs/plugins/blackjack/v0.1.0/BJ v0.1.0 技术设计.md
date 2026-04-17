# BJ v0.1.0 技术设计

## 1. 设计目标

本文档定义 `iroseclaw` 项目中 **Blackjack / 21点插件 v0.1.0** 的技术实现方案。

本方案明确采用：

- **参考现有井字棋 / 猜数字插件实现方式**
- **作为本地 runtime game plugin 实现**
- **遵守现有 `PluginHost` 标准契约：service + quick input adapter + tool package**
- **以确定性状态机驱动房间内主流程**
- **主对局流程不依赖 workflow / LLM 决策**
- **将规则内核、存储、通知、命令入口拆成可替换层**

即：

> BJ v0.1.0 是一个房间态、强状态机、service-first、以 quick input 为主入口、但同时向宿主暴露标准 tool package 的游戏插件。

---

## 2. 设计原则

### 2.1 确定性优先
21 点的规则、发牌、算点、输赢判定都应由代码直接完成，不交给模型推断。

### 2.2 聊天窗口接管式交互
参考 `tictactoe.js`：
- 显式命令开局
- 活跃对局中接管相关关键词消息
- 非游戏消息忽略

### 2.3 房间级单局互斥
v0.1.0 默认同一房间同一时间只允许一局 21 点。

### 2.4 公屏主持 + 私聊发牌
- 公屏：流程推进、轮次播报、结算
- 私聊：发玩家手牌、补牌结果、个人提示

### 2.5 主流程不走 workflow，但不脱离宿主标准
本版本的主对局流程不依赖 workflow 决策，不让 LLM 参与发牌、轮次、结算。

但这不意味着 BJ 可以绕开宿主标准能力。相反，BJ 仍应：
- 暴露标准 `games.blackjack` service
- 注册标准 `games-blackjack-package`
- 让 quick input、tool 调用、后续其他入口共享同一套 service 契约

### 2.6 核心与适配层分离
`ctx.on('message')`、IIROSE 私聊发送、文件持久化都属于适配层，不属于游戏内核。

必须保证：
- 规则计算层不直接依赖 Koishi `session`
- 状态推进层不直接操作具体私聊 API
- 入口层只做解析与转发，不能承载业务真规则

---

## 3. 参考实现与对齐对象

开发时重点参考：

### 3.1 `src/runtime/plugins/games/tictactoe.js`
可借鉴点：
- 插件独立状态存储
- 活跃对局期间直接接管消息
- 房间级 key 管理
- 配置默认值组织方式
- 持久化 / 清理机制

### 3.2 `src/runtime/plugins/games/number-guess.js`
可借鉴点：
- 房间游戏 key
- 文本关键词匹配
- 游戏状态持久化
- 历史记录与回合管理
- 对 private / includeRooms / excludeRooms 的配置模式

### 3.3 `src/index.js`
需关注：
- 当前项目整体消息主链路
- 私聊权限限制
- 已有 runtime plugin 注册机制

### 3.4 `src/runtime/plugins/host.js`
需关注：
- `registerService()`
- `registerToolPackage()`
- `registerCleanup()`
- `getPluginConfig()`
- 插件上下文对 `ctx` / `outputRuntime` / `policyEngine` / `triggerTemplateRegistry` 的暴露方式

---

## 4. 实现形态

## 4.1 文件位置

建议新增：

`src/runtime/plugins/games/blackjack.js`

## 4.2 在入口中注册

参照当前：
- `tictactoePlugin`
- `gomokuPlugin`
- `numberGuessPlugin`

在 `src/index.js` 中加入：

- `const blackjackPlugin = require('./runtime/plugins/games/blackjack');`
- `pluginHost.registerPlugin(blackjackPlugin);`

## 4.3 插件导出形态

建议保持与现有 built-in runtime plugin 一致，并显式导出 service factory：

```js
module.exports = {
  name: 'games-blackjack',
  createBlackjackService,
  apply(host, context) {
    // 注册逻辑
  }
}
```

## 4.4 标准 apply() 契约

BJ 的 `apply()` 应与现有 games 插件保持同型，而不是只注册一个匿名消息监听器：

```js
module.exports = {
  name: 'games-blackjack',
  createBlackjackService,
  apply(host, context) {
    const pluginConfig = context.getPluginConfig({});
    const service = createBlackjackService({
      ...pluginConfig,
      logger: context.logger || host.logger || console
    });

    host.registerService('games.blackjack', service);

    const cleanup = context.ctx?.on?.('message', async (session) => {
      const result = service.handleQuickInput(session);
      if (!result) return;
      await sendReply(context, session, result.ok ? result.text : result.error);
    });

    if (typeof cleanup === 'function') {
      context.registerCleanup(cleanup);
    }

    context.registerToolPackage({
      name: 'games-blackjack-package',
      version: '0.1.0',
      tools: [
        createStartTool(service),
        createJoinTool(service),
        createStatusTool(service),
        createRulesTool(service),
        createCancelTool(service)
      ],
      metadata: {
        pluginName: 'games-blackjack',
        description: '机器人主持的房间态 Blackjack / 21点'
      }
    });
  }
}
```

关键约束：
- `quick input` 与 `tool package` 都只能调用同一个 service
- 不允许 quick input 一套逻辑、tool 再维护另一套逻辑
- `apply()` 负责组装，不负责承载规则细节

---

## 5. 推荐插件配置结构

建议在 `blackjack.js` 内定义：

```js
const DEFAULT_CONFIG = {
  enabled: true,
  persist: true,
  dataDir: path.join(process.cwd(), 'data', 'games-blackjack'),
  stateFile: 'games.json',
  historyFile: 'history.json',
  oneGamePerRoom: true,
  allowPrivate: false,
  includeRooms: [],
  excludeRooms: [],
  autoCleanupMs: 30 * 60 * 1000,
  joinWindowMs: 30 * 1000,
  turnTimeoutMs: 60 * 1000,
  dealerStandScore: 17,
  minPlayers: 1,
  maxPlayers: 6,
  quoteReply: false,
  requireMentionToStart: false,
  startKeywords: ['21点开局', 'bj开局', 'blackjack'],
  joinKeywords: ['加入21点', '加入bj', '加入'],
  leaveKeywords: ['退出21点', '退出bj', '退出'],
  beginKeywords: ['开始21点', '开始bj', '开牌'],
  hitKeywords: ['要牌', 'hit', '要'],
  standKeywords: ['停牌', 'stand', '停'],
  statusKeywords: ['21点状态', 'bj状态', '状态'],
  cancelKeywords: ['21点取消', '取消bj', '取消']
}
```

### 说明
- `allowPrivate: false`：游戏主交互不走私聊
- `quoteReply: false`：减少聊天噪音
- `requireMentionToStart: false`：允许房间内直接命令式触发
- 短关键词如 `加入 / 开始 / 要 / 停 / 状态` 只应在活跃牌局房间内生效

### 5.2 Service factory 注入依赖

除了可序列化配置，`createBlackjackService(options)` 还应允许注入以下非配置型依赖：

- `store`：状态存储实现
- `historyStore`：历史记录写入实现
- `notifier`：房间播报 / 私聊通知实现
- `now`：时钟函数
- `shuffle` / `random`：随机与洗牌实现
- `ruleset`：后续规则扩展入口
- `logger`：日志实现

这些依赖是代码级扩展点，不要求直接暴露给最终用户配置文件，但实现时应留出注入能力。

---

## 6. 消息监听策略

## 6.1 总原则

BJ 的主流程不通过 workflow runtime 决策，但 quick input 监听器只是**入口适配层**，不是插件核心。

### 推荐策略
- 插件在 `apply()` 中注册消息监听
- 监听器只负责把消息适配为 service 输入
- service 统一处理：
  1. 提取 `channelId / userId / username / text`
  2. 判断当前房间是否允许运行游戏
  3. 判断该房间是否已有 BJ 活跃对局
  4. 如果无对局：只识别开局类命令
  5. 如果有对局：识别加入、开始、要牌、停牌、状态、取消等命令

### 6.1.1 多入口约束
- `handleQuickInput(session)` 是当前主入口
- tool package 应调用同一 service 的显式方法
- 后续若加入私聊回复入口、后台管理入口、统一 dispatcher，也必须走同一个 service / domain 层

## 6.2 监听优先级

建议逻辑优先级：

1. **先判断是否是 BJ 相关关键词**
2. 不是则立即忽略
3. 是则判断房间中是否存在对局
4. 再根据当前状态执行相应 handler

## 6.3 活跃对局时的短命令接管

为避免误触：

- `要牌`
- `停牌`
- `状态`
- `加入`
- `开始`

这些短命令 **只在该房间存在活跃 BJ 对局时生效**。

否则不要接管普通聊天。

---

## 7. 状态模型设计

## 7.1 房间局状态结构

建议：

```js
{
  gameId: 'bj:roomId:timestamp',
  roomId: '69ac...',
  status: 'waiting',
  createdBy: {
    uid: 'xxx',
    username: 'Alice'
  },
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  joinDeadline: 1710000030000,
  turnDeadline: 1710000060000,
  players: [
    {
      uid: 'u1',
      username: 'Alice',
      hand: [],
      bestScore: 0,
      isBlackjack: false,
      isBust: false,
      isStand: false,
      isDone: false,
      hasReceivedPrivateCards: false,
      result: ''
    }
  ],
  dealer: {
    hand: [],
    bestScore: 0,
    isBlackjack: false,
    isBust: false,
    revealed: false
  },
  deck: [],
  currentPlayerIndex: 0,
  actionHistory: []
}
```

## 7.2 主状态机

建议房间局状态：

- `idle`：无局（实际可不持久化此态）
- `waiting`：已开局，等待加入
- `dealing`：发牌阶段
- `player_turn`：玩家轮次阶段
- `dealer_turn`：庄家轮次阶段
- `settled`：已结算
- `cancelled`：已取消

## 7.3 玩家状态字段

每位玩家：
- `isBlackjack`
- `isBust`
- `isStand`
- `isDone`
- `bestScore`
- `result`

其中：
- `isDone = isBlackjack || isBust || isStand`

---

## 8. 模块划分建议

建议 `blackjack.js` 内部按下面职责组织函数。即便 v0.1.0 先放在单文件中，逻辑分层也必须清楚：

- **插件入口层**：`apply()`，负责组装 host/context/service
- **应用服务层**：对外暴露 `games.blackjack` API，承接 quick input / tool 调用
- **领域规则层**：发牌、算点、轮次推进、结算，不直接依赖 Koishi / IIROSE
- **基础设施层**：store、history、notifier、clock、random
- **表现层**：公屏文案、私聊文案、状态渲染

如果后续把文件拆分成 `service.js`、`rules.js`、`notifier.js`、`tools.js`，应能无痛迁移。

## 8.1 配置与工具函数层

- `toPositiveInt()`
- `normalizeText()`
- `normalizeStringArray()`
- `clone()`
- `ensureDirectory()`
- `readJsonFile()`
- `writeJsonFile()`
- `normalizeEpochTimestamp()`
- `isPrivateChannel()`
- `isRoomAllowed()`

## 8.2 存储层

- `createGameStore(config)`
  - `get(roomKey)`
  - `set(roomKey, gameState)`
  - `delete(roomKey)`
  - `list()`
  - `cleanupExpired()`

可完全参考井字棋 / 猜数字的 store 模式。

## 8.3 牌组与规则层

- `createDeck()`
- `shuffleDeck(deck)`
- `drawCard(game)`
- `calculateHandValue(hand)`
- `detectBlackjack(hand)`
- `isBust(score)`
- `dealerShouldHit(score, config)`
- `settlePlayerVsDealer(player, dealer)`

### 牌结构建议

```js
{
  suit: '♠',
  rank: 'A',
  value: 11,
  code: 'A♠'
}
```

或最简：

```js
{
  rank: 'A',
  suit: 'spade'
}
```

展示时再格式化。

## 8.4 游戏状态推进层

- `createGame(session, config)`
- `joinGame(game, session)`
- `leaveGame(game, session)`
- `beginGame(game, session, config)`
- `dealInitialCards(game, config)`
- `handleHit(game, session, config)`
- `handleStand(game, session, config)`
- `advanceToNextPlayer(game, config)`
- `runDealerTurn(game, config)`
- `settleGame(game, config)`
- `cancelGame(game, session, config)`

## 8.5 输出层

- `sendRoomMessage(session, text, options)`
- `sendPrivateCards(session, player, game, options)`
- `sendPrivateDrawResult(session, player, game, options)`
- `renderDealerUpcard(game)`
- `renderPlayerHandPrivate(player)`
- `renderGameStatus(game)`
- `renderSettlement(game)`

## 8.6 命令识别层

- `matchCommand(text, config, hasActiveGame)`
- `isStartCommand()`
- `isJoinCommand()`
- `isBeginCommand()`
- `isHitCommand()`
- `isStandCommand()`
- `isStatusCommand()`
- `isCancelCommand()`

---

## 9. 房间消息处理流程

建议主处理流程：

```text
收到消息
  ↓
提取 channelId / userId / username / text
  ↓
房间是否允许游戏？
  ├─ 否 → 忽略
  └─ 是
       ↓
查询该 room 是否有活跃 BJ 对局
       ↓
匹配命令
       ├─ 无命令 → 忽略
       └─ 有命令
            ↓
根据当前状态分派 handler
```

### 典型 dispatch 结构

- 无局：
  - 只允许 `开局`

- `waiting`：
  - 允许 `加入`
  - 允许 `退出`
  - 允许 `开始`
  - 允许 `状态`
  - 允许 `取消`

- `player_turn`：
  - 当前玩家允许 `要牌 / 停牌`
  - 其他玩家可 `状态`
  - 房主/管理员可 `取消`

- `dealer_turn`：
  - 不接收普通玩家操作
  - 可查询 `状态`

- `settled / cancelled`：
  - 清理后回到无局

---

## 10. 私聊发送设计

## 10.1 v0.1.0 的边界

玩家**不通过私聊回复指令**。

私聊只承担：
- 发初始手牌
- 发补牌结果
- 发个人状态提示

## 10.2 实现要求

插件需要封装 notifier，而不是让状态机直接操作具体私聊 API。最小接口建议：

```js
const notifier = {
  sendRoom(session, text, options = {}) {},
  sendPrivate(player, text, options = {}) {},
  reportPrivateDeliveryFailure(session, player, error, options = {}) {}
};
```

如果 v0.1.0 不单独拆文件，至少也应在 `createBlackjackService()` 内部把它组织成独立接口对象。

### 设计要求
- 私聊发送成功 → 标记成功
- 私聊发送失败 → 记录日志 + 公屏降级提示
- 不能因某个玩家私聊失败导致整局中断
- 状态推进函数只消费 notifier 的结果，不直接依赖底层适配器细节

## 10.3 技术风险说明

当前项目现成代码里，公屏输出链路清晰；但“按 UID 主动私聊指定用户”的具体发送接口，需要结合 IIROSE 适配器确认。

因此实现时建议：

### 方案 A（首选）
若适配器支持指定用户私聊：
- 正常私聊发送

### 方案 B（兜底）
若适配器无法稳定指定私聊：
- 文档和代码中保留私聊函数接口
- 先实现“可插拔发送器”
- 失败时公屏提示：
  - `已尝试私聊发送你的手牌，如未收到请联系管理员。`

也就是说：

> v0.1.0 的逻辑必须依赖“私聊发送接口抽象”，但不能把它写死在主状态机里。

---

## 11. 发牌与算点设计

## 11.1 牌堆初始化

每局开始时：
- 生成标准 52 张牌
- Fisher-Yates 洗牌
- 存到 `game.deck`

## 11.2 起手发牌

顺序建议：
1. 给每个玩家发 1 张
2. 给庄家发 1 张（明牌）
3. 给每个玩家发 1 张
4. 给庄家发 1 张（暗牌）

这样更贴近真实 Blackjack 节奏。

## 11.3 点数计算

A 的处理建议：
- 先按 11 计
- 若总分 > 21，则将 A 从 11 降为 1，直到不爆或无 A 可降

## 11.4 Blackjack 判定

仅起手两张时判定 `isBlackjack`。

---

## 12. 玩家轮次推进设计

## 12.1 当前玩家判定

使用：
- `currentPlayerIndex`

当前有效玩家为：
- `players[currentPlayerIndex]`

## 12.2 要牌流程

当前玩家发送 `要牌`：
- 抽 1 张牌
- 更新 `hand`
- 重算 `bestScore`
- 私聊新手牌
- 若爆牌：
  - `isBust = true`
  - `isDone = true`
  - 公屏播报爆牌
  - 切下一位
- 若未爆：
  - 保持当前玩家继续行动

## 12.3 停牌流程

当前玩家发送 `停牌`：
- `isStand = true`
- `isDone = true`
- 公屏播报
- 切下一位

## 12.4 自动跳过

以下玩家在轮转中应自动跳过：
- `isBlackjack`
- `isBust`
- `isStand`
- `isDone`

如果全部玩家都 done，则进入 `dealer_turn`。

---

## 13. 庄家回合设计

## 13.1 进入条件

所有玩家 `isDone = true` 后进入庄家回合。

## 13.2 庄家逻辑

- 先公开暗牌
- 重算庄家点数
- 若 `< dealerStandScore`（默认 17）则继续补牌
- 每次补牌都公屏播报
- 到达 `>= 17` 或爆牌后停止

## 13.3 庄家无私聊

庄家所有行动都在公屏展示。

---

## 14. 结算设计

## 14.1 结算规则函数

建议：

```js
function settlePlayerVsDealer(player, dealer) {
  // returns: win / lose / push / blackjack-win / bust
}
```

## 14.2 结算文案结构

建议公屏统一输出：

- 庄家手牌 + 点数
- 每位玩家手牌摘要 + 点数 + 结果

### 示例

```text
本局 21 点结算：
庄家：K♠ 7♥ = 17
Alice：A♣ 9♦ = 20，获胜
Bob：10♣ 8♠ 5♦ = 23，爆牌失败
Cindy：A♥ K♦ = Blackjack，获胜
```

## 14.3 清理时机

结算消息发出后：
- 将状态设为 `settled`
- 写入历史
- 稍后立即清理房间活跃局

---

## 15. 超时与容错设计

## 15.1 报名超时

`waiting` 状态超过 `joinWindowMs`：

- 若玩家数 >= `minPlayers`
  - 自动开始
- 否则
  - 自动取消
  - 公屏提示人数不足

## 15.2 轮次超时

`player_turn` 状态超过 `turnTimeoutMs`：

v0.1.0 建议默认：
- 自动判定该玩家 `停牌`
- 公屏提示“超时，已自动停牌”
- 然后进入下一位

这比“直接取消整局”更友好。

## 15.3 插件重启

v0.1.0 不强制支持断点恢复。

但如果 `persist=true`，可以保留状态文件；启动时：
- 清理过期对局
- 对未完成旧局直接标记失效或清理

建议不要尝试自动续局。

## 15.4 私聊失败

- 记录 `player.hasReceivedPrivateCards = false`
- 写日志
- 公屏给出降级提示
- 游戏继续进行

---

## 16. 房间限制与权限设计

## 16.1 oneGamePerRoom

默认开启：
- 同房只能 1 局

## 16.2 发起人权限

建议：
- 开局者为 host
- `开始21点` / `取消21点` 默认由 host 或管理员执行

## 16.3 普通玩家权限

普通玩家可以：
- `加入`
- `退出`（仅 waiting）
- 自己轮次 `要牌 / 停牌`
- `状态`

---

## 17. 日志与历史记录设计

## 17.1 actionHistory

建议在 gameState 中记录关键动作：

```js
{
  at: 1710000000000,
  type: 'player-hit',
  uid: 'u1',
  username: 'Alice',
  detail: 'draw 5♠'
}
```

## 17.2 historyFile

可选地将已结算局写入：

`data/games-blackjack/history.json`

用于后续：
- 排错
- 回放
- 做排行榜扩展

v0.1.0 不必复杂化，只需保存最近若干局即可。

---

## 17.5 tool package 注册策略

结合当前项目框架，BJ 应与现有 games 插件保持一致：**quick input 是主交互入口，但 tool package 仍是标准宿主暴露面。**

### 必做
- 插件 service
- quick input 监听
- 公屏输出
- 状态持久化
- 注册 `games-blackjack-package`

### tool package 的职责
- 暴露 `@Bot 21点` 一类显式入口
- 进入 help / package / trigger template 体系
- 为未来 workflow、proactive、管理工具复用 BJ service 提供标准接入点

### 设计约束
- tool 与 quick input 必须共享同一 service
- 对局态主流程仍以 quick input 为主，不把每个轮次都强行改造成 workflow
- BJ 首版不为了 workflow 而复杂化规则内核，但也不能因为首版收缩而失去标准可插拔性

因此本版本的主实现顺序应是：
1. service / domain core
2. quick input adapter
3. room reply + private notifier
4. tool package adapter
5. 再补更高阶扩展（如私聊回复、下注、排行榜）

---

## 18. 关键函数清单（建议实现）

### 插件入口 / 服务
- `createBlackjackService(options)`
- `createBlackjackToolBundle(service)`
- `createBlackjackNotifier(options)`
- `apply(host, context)`

### 配置/存储
- `createGameStore(config)`
- `getGameKey(session)`
- `isRoomAllowed(channelId, config)`

### 规则
- `createDeck()`
- `shuffleDeck(deck)`
- `drawCard(game)`
- `calculateHandValue(hand)`
- `hasBlackjack(hand)`
- `dealerShouldHit(score, config)`
- `settlePlayerVsDealer(player, dealer)`

### 状态流转
- `createNewGame(session, config)`
- `addPlayer(game, session, config)`
- `removePlayer(game, session, config)`
- `startGame(game, session, config)`
- `dealInitialCards(game, config)`
- `performHit(game, player, config)`
- `performStand(game, player, config)`
- `moveToNextPlayer(game, config)`
- `runDealerPhase(game, config)`
- `finishGame(game, config)`
- `cancelGame(game, reason)`

### 输出
- `renderRoomGameSummary(game)`
- `renderPrivatePlayerHand(player)`
- `renderSettlement(game)`
- `trySendPrivateMessage(...)`
- `broadcastTurnPrompt(...)`

### 监听/分发
- `matchCommand(text, config, hasActiveGame)`
- `handleWaitingState(...)`
- `handlePlayerTurnState(...)`
- `handleDealerTurnState(...)`
- `handleGameMessage(session, state, command, context)`

---

## 19. 伪代码流程

## 19.1 开局

```text
收到“21点开局”
  ↓
若当前房间已有活跃局 → 拒绝
  ↓
创建 gameState(status=waiting)
  ↓
发起人自动加入
  ↓
保存 state
  ↓
公屏宣布报名开始
```

## 19.2 开始

```text
收到“开始21点”
  ↓
检查状态必须为 waiting
  ↓
检查发起人/管理员权限
  ↓
洗牌 + 发初始牌
  ↓
给玩家私聊发送手牌
  ↓
若有玩家起手 Blackjack，直接标 done
  ↓
设置 status=player_turn
  ↓
找到第一个未 done 玩家
  ↓
公屏提示轮次开始
```

## 19.3 要牌

```text
收到“要牌”
  ↓
检查状态必须为 player_turn
  ↓
检查是否当前玩家
  ↓
抽牌
  ↓
重算点数
  ↓
私聊玩家新手牌
  ↓
若爆牌 → 标记 done 并轮转
  ↓
否则继续等待该玩家操作
```

## 19.4 停牌

```text
收到“停牌”
  ↓
检查状态必须为 player_turn
  ↓
检查是否当前玩家
  ↓
标记 stand + done
  ↓
轮转下一位
  ↓
若无下一位 → dealer_turn
```

## 19.5 结算

```text
dealer_turn
  ↓
公开庄家暗牌
  ↓
按规则补牌到 >=17 或爆
  ↓
逐个结算玩家结果
  ↓
公屏输出总结
  ↓
写历史
  ↓
删除活跃局
```

---

## 20. 与需求文档的落地对应

本技术设计对应需求文档中的关键决策：

- 主流程不走 workflow：已明确为确定性本地状态机实现
- 对齐现有 games 插件：已采用 service + quick input + tool package 的标准宿主契约
- 公私聊分工：已拆分 notifier / output 责任
- 私聊不收指令：已作为 v0.1.0 边界
- 关键词响应：已作为当前主入口方式
- 房间单局：已内建 oneGamePerRoom
- 可插拔性：已把规则、存储、通知、命令入口拆为独立边界

---

## 21. 推荐测试清单

### 单元测试
- 牌堆生成正确
- 洗牌后数量正确
- 点数计算正确
- A 的 1/11 切换正确
- Blackjack 判定正确
- 庄家补牌逻辑正确
- 结算规则正确

### 插件流程测试
- 开局成功
- 加入成功
- 重复加入拒绝
- 开牌成功
- 私聊发送函数被调用
- 当前玩家要牌成功
- 非当前玩家要牌被拒绝
- 玩家爆牌正确
- 庄家回合正确
- 结算正确
- 取消成功
- 超时逻辑正确

---

## 22. 开发建议结论

BJ v0.1.0 最佳落地路线不是“做成 AI 工具”，也不是“写成只能靠消息监听跑的特例脚本”，而是：

> 参照现有 games 插件，做一个**本地状态机驱动、service-first、以 quick input 为主入口、由机器人公屏主持并通过私聊发送手牌，同时向宿主注册标准 tool package** 的游戏插件。

这样做有几个核心优点：

1. 和现有项目架构最兼容
2. 不受 workflow 干扰，但不脱离框架标准能力
3. 游戏体验更像真正的机器人主持
4. 后续容易继续做：
   - 双倍
   - 分牌
   - 下注
   - 排行榜
   - 私聊操作白名单
   - 统一游戏调度器 / 更多命令入口

这就是 BJ v0.1.0 的推荐技术路线。
