# iroseclaw

IIROSE 聊天室机器人，基于 [Koishi](https://koishi.chat) 扩展 workflow 框架设计。

## 快速开始

0. 项目准备

- 环境准备：Node.js 20+、npm、Git

- 克隆项目：
```bash
git clone https://github.com/Nobeta-Work/iroseclaw.git
cd iroseclaw
```

1. 安装依赖

```bash
npm install
```

2. 编辑默认 prompt

`prompt/角色.md` 是初始调用的默认样式，也是最小部署入口。
快速开始：在`角色.md`中编写你的 AI 人设提示词。

3. 填少量配置

**蔷薇花园账号配置**

- `config/app.json`
  - `bot.uid`
  - `bot.name`
  - `roomId`
  - `auth.iiroseUsername`
  - `auth.iirosePassword`
  - `admins`
  - 如需切换样式，改 `workflow.promptProfile.activePrompt`
- `koishi.yml`
  - `app.nickname`
  - `plugins.koishi-plugin-adapter-iirose:iirose.roomId`
  - `plugins.koishi-plugin-adapter-iirose:iirose.usename`
  - `plugins.koishi-plugin-adapter-iirose:iirose.uid`
  - `plugins.koishi-plugin-adapter-iirose:iirose.password`

**大模型 API 配置**
- `config/app.json`
  - `providers.default`：默认 provider 名称 # 默认<name>为`default`，或追加 provider
  - `providers.named.<name>.type`：通常填 `openai-compatible`
  - `providers.named.<name>.baseUrl`：API 地址
  - `providers.named.<name>.apiKey`：API Key
  - `providers.named.<name>.model`：模型名
  - 可选项：`endpointPath`、`timeout`、`headers`、`extraBody`、`maxTokens`

> 存在 OpenClaw 的配置项，但是不建议直接上手，而是让 OpenClaw 自己调用。
> 除非你知道调用的链路，否则不要使用 OpenClaw 配置。

4. 启动

后台运行：

```bash
npm run start:bg
```

查看状态：

```bash
npm run status:bg
```

停止/重启：

```bash
npm run stop:bg
npm run restart:bg
```

5. 大功告成

## prompt 约定

- 默认 prompt: `prompt/角色.md`
- 全局前置 prompt: `prompt/IIC.md`
> `IIC.md` 除非为空，必定载入。用于存放所有人设共用的知识、概念。不影响其他 prompt 占位。
> 因此默认情况下载入的 prompt 文件为 `IIC.md` + `角色.md`


## 🤖特性
- 🎵 点歌功能（网易云音乐）
- 😄 情绪表情包（聊天时按概率触发，走第三方图库检索）
- 🎮 游戏（基于文字的若干游戏：井字棋、五子棋、21点）
- 🎭 主动模式（让 AI 更积极参与）
- 🪜 跟随切换房间
- 💾 记忆系统

> 所有的功能，如果你忘记了，可以直接询问 bot，或者让他直接调用。

## 可配置项
*如果你有更细分的微调配置需求，请参考如下。*
### 情绪表情包
- 入口：`config/app.json -> meme`
- `enabled`：总开关，默认 `true`
- `triggerProbability`：触发表情包的概率，范围 `0~1`，建议先从 `0.1~0.3` 开始
- `requestEmotionTag`：是否让模型先输出情绪标签，默认 `true`
> 情绪表情包没有被控制反转，不受大模型操控。

### 主动模式
- 入口：`pluginConfigs.proactive-topic-engagement`
- `defaultEnabled`：是否默认开启主动介入
- `defaultModeName`：模式名，展示给管理员看
- `dataDir` / `settingsFile`：状态存放位置，多实例部署时要分开
- `windowMs`：统计窗口
- `minMessages`、`minParticipants`：触发门槛
- `maxAverageGapMs`、`maxSpeakerRatio`：群聊活跃度阈值
- `minBotSilenceMs`、`cooldownMs`：避免机器人连续打断
- `includeRooms` / `excludeRooms`：限定或排除房间
- 管理指令：`开启主动模式`、`关闭主动模式`、`主动模式状态`、`命名主动模式 茶水间模式`
- 建议先单房间试跑，再逐步放开范围

### 记忆系统
- 短期记忆入口：`messageMemory`
- 长期人格记忆入口：`workflow.promptProfile.memory`
- `messageMemory.enabled`、`dataDir`、`maxEventsPerChannel`、`recentMessageCount`、`maxAnchorRounds`、`compactCheckInterval`、`compactOnStartup`、`maxMessageChars`、`persist`
- `workflow.promptProfile.memory.enabled`、`persist`、`dataDir`、`maxEntries`、`summaryThresholdRounds`、`summaryThresholdAgeMs`、`compressionPickCount`、`compressionTargetCount`、`timeoutMs`
- `prompt/*.md` 里的 `<<<IIC_PERSONA_MEMORY` 块会被自动读写，不要手工改格式
- 多实例部署时，`dataDir` 和 `stateFile` 最好都分开

## 许可
MIT