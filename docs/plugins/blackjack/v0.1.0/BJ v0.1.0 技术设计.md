# BJ v0.1.0 技术设计

## 1. 设计目标

本文档定义 `iroseclaw` 项目中 **Blackjack / 21点插件 v0.1.0** 的技术实现方案。

本方案明确采用：

- **参考现有井字棋 / 猜数字插件实现方式**
- **作为本地游戏插件实现**
- **直接监听聊天窗口消息**
- **通过关键词驱动状态机**
- **不走 workflow 通道**
- **不依赖 LLM 决策**

即：

> BJ v0.1.0 是一个房间态、关键词驱动、强状态机、非 workflow 的游戏插件。

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

### 2.5 不改造为 workflow 工具
本版本不注册 workflow tool package，不让 LLM 参与游戏流程。

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

建议保持与现有 built-in runtime plugin 一致：

```js
module.exports = {
  name: 'games-blackjack',
  apply(host, context) {
    // 注册逻辑
  }
}
```

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

---

## 6. 消息监听策略

## 6.1 总原则

BJ 插件不通过 workflow 入口执行，而是在插件内部直接监听消息。

### 推荐策略
- 插件在 `apply()` 中直接注册消息监听
- 每条消息进入后：
  1. 提取 `channelId / userId / username / text`
  2. 判断当前房间是否允许运行游戏
  3. 判断该房间是否已有 BJ 活跃对局
  4. 如果无对局：只识别开局类命令
  5. 如果有对局：识别加入、开始、要牌、停牌、状态、取消等命令

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

建议 `blackjack.js` 内部按下面职责组织函数。

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

插件需要封装一个“尝试私聊”能力：

```js
async function trySendPrivateMessage(ctx, playerUid, text, options = {})
```

### 设计要求
- 私聊发送成功 → 标记成功
- 私聊发送失败 → 记录日志 + 公屏降级提示
- 不能因某个玩家私聊失败导致整局中断

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

## 17.5 是否注册 tool package（收缩建议）

结合当前项目框架，建议做如下收缩：

### 必做
- 插件 service
- quick input 监听
- 公屏输出
- 状态持久化

### 可做但非必须
- 注册 tool package 作为 `@Bot 21点` 之类显式入口

原因：
- 当前已有游戏插件虽然也会注册 tool package
- 但真正的“对局进行时交互”靠的都是 quick input
- BJ 首版不应为了 tool package 设计而复杂化主流程

因此本版本的主实现顺序应是：
1. service
2. quick input
3. room reply
4. best-effort private notify
5. 最后再考虑是否补 tool package

---

## 18. 关键函数清单（建议实现）

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

- 不走 workflow：已明确为本地插件监听式实现
- 参考井字棋：已对齐 store / command interception / room game 模式
- 公私聊分工：已拆分输出层
- 私聊不收指令：已作为 v0.1.0 边界
- 关键词响应：已作为主要驱动方式
- 房间单局：已内建 oneGamePerRoom

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

BJ v0.1.0 最佳落地路线不是“做成 AI 工具”，而是：

> 参照井字棋与猜数字，做一个**本地状态机驱动、关键词接管聊天窗口、由机器人公屏主持且通过私聊发送手牌**的游戏插件。

这样做有几个核心优点：

1. 和现有项目架构最兼容
2. 不受 workflow 干扰
3. 游戏体验更像真正的机器人主持
4. 后续容易继续做：
   - 双倍
   - 分牌
   - 下注
   - 排行榜
   - 私聊操作白名单

这就是 BJ v0.1.0 的推荐技术路线。
