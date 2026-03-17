# iroseclaw

IIROSE 聊天室 AI 机器人，基于 [Koishi](https://koishi.chat) 框架 + [OpenClaw](https://openclaw.ai) 驱动。

## 特性

- 🤖 OpenClaw AI 驱动的智能聊天
- 🎵 点歌功能（网易云音乐）
- 😄 情绪表情包（聊天时按概率触发，走第三方图库检索）
- 🔒 基于 UID 的权限控制，防止同名冒充
- 🧩 可扩展的技能插件系统（支持本地 JS/Python + 远程 URL 插件）
- 📋 结构化 JSON 协议，支持审计日志
- ⚙️ 高度可配置，面向开源

## 快速开始

1. 安装依赖
```bash
cd /opt/projects/iroseclaw
npm install
```

2. 配置机器人
```bash
nano config/app.json
nano koishi.yml
```
编辑完成后保存。

3. 启动
```bash
npm run dev
```

## 配置优先级

统一配置入口为 `src/config/runtime.js`，加载优先级如下（后者覆盖前者）：

1. 内置默认值
2. `config/app.json`
3. 环境变量（如 `IROSE_BOT_UID`、`IROSE_ADMINS`）

## AI 人设与 OpenClaw 边界

本项目采用“提示词工程主导人设”：

1. 人设与风格（唯一入口）
- 文件：`config/app.json`
- 字段：`workflow.promptProfile`
- 用途：注入机器人身份、风格说明与当前风格（平淡/热情/爱慕等），由项目 Prompt Compiler 统一拼装。

2. OpenClaw 仅作为被代理 AI 接口（transport）
- 文件：`config/app.json`
- 字段：`openclaw.agentLabel`（兼容旧字段 `openclaw.subagentLabel`）
- 环境变量覆盖：`IROSE_OPENCLAW_AGENT`（兼容 `IROSE_OPENCLAW_SUBAGENT`）
- 用途：仅指定 transport agent，不承载人格。

3. 会话策略
- 字段：`openclaw.stateless` / `openclaw.useNativeSessionContext`
- 默认：`stateless=true`
- 说明：默认按无状态 provider 使用。仅当你明确需要 OpenClaw 原生会话记忆时，再开启 `useNativeSessionContext=true`。

4. 失败兜底
- 字段：`fallbackResponses`
- 用途：provider 失败、无回复、执行异常时统一兜底。

5. 普通 OpenAI 兼容 API（与 OpenClaw 同级）
- 文件：`config/app.json`
- 字段：`providers.default` + `providers.named.<providerName>`
- 用途：直接接入任意兼容 OpenAI Chat Completions 的普通 AI API（`baseUrl` / `apiKey` / `model`）。

示例（将默认 provider 切到普通 API）：

```json
{
  "providers": {
    "default": "general-http",
    "named": {
      "general-http": {
        "type": "openai-compatible",
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "your_api_key",
        "model": "gpt-4.1-mini",
        "endpointPath": "/chat/completions",
        "timeout": 30000,
        "maxTokens": 0,
        "enabled": true
      }
    }
  }
}
```

可选字段说明：

- `endpointPath`：默认 `/chat/completions`
- `headers`：附加请求头（对象）
- `timeout`：请求超时（毫秒）
- `maxTokens`：最大输出 token（`0` 表示沿用 provider 默认）

说明：

- 该模式下，OpenClaw 可保留在配置中但不作为默认 provider 使用。
- 人设仍由 `workflow.promptProfile` 注入，不依赖 provider 侧人格设置。

## 情绪表情包

聊天链路支持“方案一”：

1. OpenClaw 回复末尾附带情绪标签（`[[EMO:开心]]`）。
2. 机器人先发送文本回复；若按概率触发，则再发送一条格式化标记（例如：`$image＝开心$`）。
3. 发送链路插件会在 `before-send` 阶段拦截该标记，并调用当前启用的搜索引擎。
   - 当前排查阶段只启用 `Bing`；其他 provider 保留在代码中，但未激活。
   - 后续可在 provider 激活列表中逐个恢复 `Tenor/GIPHY/Pexels/Pixabay` 做对比测试。
   - 检索词会自动按“情绪信息 + 表情包 + 白圣女”拼接，优先贴合当前社区风格。
4. 命中图片后，将标记替换为 `[url#e]` 图片段并发送；未命中则原样放行。

配置（`config/app.json`）：

```json
{
  "meme": {
    "enabled": true,
    "triggerProbability": 0.3,
    "requestEmotionTag": true
  }
}
```

可选环境变量（第三方 API Key）：

- `TENOR_API_KEY`（默认会尝试公开测试 key）
- `GIPHY_API_KEY`
- `PEXELS_API_KEY`
- `PIXABAY_API_KEY`
- `IROSE_MEME_TIMEOUT_MS`（默认 6000 毫秒）
- `IROSE_MEME_STYLE_KEYWORD`（默认 `白圣女`）
- `IROSE_MEME_BLOCKED_HOSTS`（默认屏蔽 `588ku.com,bpic.588ku.com,ibaotu.com,pic.ibaotu.com`）

手动联网测试：

- `node tests/meme-search-live-test.js`
- 可追加情绪参数，例如：`node tests/meme-search-live-test.js 开心 惊讶`

## 远程插件（URL）

支持在配置中填写远程 JS 链接，启动时自动下载并加载到技能系统。

- 配置位置：`remotePlugins.entries`
- 生效时机：进程启动时加载（当前不是热插拔）
- 建议：使用 HTTPS + 固定版本链接 + `sha256` 校验

示例（`config/app.json`）：

```json
{
  "remotePlugins": {
    "entries": [
      {
        "url": "https://cdn.example.com/plugins/music-vip-bypass.bundle.js",
        "enabled": true,
        "sha256": "your_sha256_hex"
      }
    ],
    "timeout": 10000,
    "allowHttp": false
  }
}
```

远程插件导出格式需兼容本地技能：

```js
module.exports = {
  name: 'my-plugin',
  keywords: ['示例'],
  description: '示例插件',
  handler: async ({ session, args }) => 'ok'
}
```

## 音乐插件

用途：根据“点歌”请求检索歌曲并返回可播放链接。插件支持多播放源 provider 级联兜底。

核心配置（`config/app.json`）：

- `music.playUrlProviders`：播放源顺序（如 `["iarcDirect","metingRedirect","neteaseOuter"]`）
- `music.providers.customTemplate.enabled/urlTemplate`
- `music.providers.iarcDirect.enabled/urlTemplate`
- `music.providers.metingRedirect.enabled/endpointTemplate`
- `music.providers.neteaseOuter.enabled/urlTemplate`

最小示例：

```json
{
  "music": {
    "playUrlProviders": ["iarcDirect", "metingRedirect", "neteaseOuter"]
  }
}
```

常见调优：

- 某个播放源不稳定时，将其从 `playUrlProviders` 中移到后面或临时移除。
- 需要私有播放地址时，启用 `customTemplate` 并配置 `urlTemplate`。

## 内置插件列表

以下为当前主要内置插件与用途（配置入口统一在 `config/app.json`，插件级配置走 `pluginConfigs.<pluginName>`）：

- `builtin-help`：帮助信息与可用指令概览（`help.show`）
- `builtin-music`：点歌与音乐播放链接（`music.play_netease`）
- `builtin-messaging-tools`：统一输出工具（`reply.current` / `message.route`）
- `builtin-workflow-prompt-profile`：管理员可查看/切换提示词风格（`workflow.prompt.style.*`）
- `builtin-openclaw-provider` / `builtin-openai-compatible-providers`：模型 provider 注册
- `builtin-workflow-planners`：workflow planner 注册（llm / llm-default）
- `iirose-system-tools`：论坛/任务/排行榜查询
- `iirose-user-profile-tools`：用户资料查询
- `iirose-room-tools`：房间查询/切换
- `games-tictactoe`：井字棋
- `games-number-guess`：猜数字
- `proactive-topic-engagement`：主动介入（管理员控制开关，`pluginConfigs.proactive-topic-engagement`）
- `remote-room-monitoring`：房间监控分析（`pluginConfigs.remote-room-monitoring`）

## 主动调度插件

当前已内置一个“当前房间窗口触发”调度插件，但默认关闭：

- 插件名：`scheduler-current-room-windowed`
- 作用：在预定时间点检查“当前房间最近一段时间内是否有人发言”，若有，则主动发起一次 workflow
- 当前实现规则：
  - 仅检查当前房间
  - 默认检查最近 `5` 分钟
  - 仅统计非 bot 的用户消息
  - 有消息则触发
  - 无消息则跳过
  - 不做补偿

示例配置：

```json
{
  "pluginConfigs": {
    "scheduler-current-room-windowed": {
      "enabled": false,
      "channelId": "your_room_id",
      "timezone": "Asia/Shanghai",
      "slots": ["09:30", "10:30"],
      "lookbackMinutes": 5,
      "instruction": "如果最近5分钟内房间有人发言，请结合这些发言自然接一句，不要像系统播报。",
      "sendFallbackOnError": false
    }
  }
}
```

说明：

- `enabled=false` 时插件仅注册，不会主动发消息
- `channelId` 为空时，会优先尝试使用当前配置中的 `roomId`
- 触发后走统一 `workflow` 链路，而不是绕过 runtime 直接发消息

## 配置字段总览

以下字段是当前用户可配置主入口（`config/app.json`）：

- `bot.uid` / `bot.name` / `bot.platform`
- `roomId`
- `auth.iiroseUsername` / `auth.iirosePassword`
- `admins`
- `runtime.mode`
- `workflow.maxSteps` / `workflow.maxToolCallsPerStep` / `workflow.allowParallelReadTools`
- `workflow.promptProfile`（机器人人设、风格集合、默认风格）
- `openclaw.agentLabel` / `openclaw.timeout` / `openclaw.stateless` / `openclaw.useNativeSessionContext`
- `providers.default` / `providers.named`
- `music.*`
- `messageMemory.*`
- `meme.*`
- `remotePlugins.*`
- `pluginConfigs.*`
- `fallbackResponses`
- `rateLimit.perMinute`
- `policy.*`

## 提交前脱敏流程

单配置模式下，运行机器人与开发都使用同一个 `config/app.json` + `koishi.yml`。提交前请先抽离敏感信息：

```bash
npm run config:extract
```

该命令会：

- 把敏感值备份到 `/tmp/iroseclaw-secrets-<timestamp>.json`
- 将 `config/app.json` 和 `koishi.yml` 改为可公开提交的初始化值

提交完成后恢复本机运行配置：

```bash
npm run config:restore -- /tmp/iroseclaw-secrets-<timestamp>.json
```

## 架构

```
IIROSE 消息 → @检测 (UID) → 权限判定 → Prompt Compiler(注入人设/风格) → OpenClaw Provider(transport) → 结构化 JSON → 技能/脚本 → 回复
```

## 目录结构

- `src/` — 源代码
- `src/core/` — 核心模块（消息处理、权限、协议）
- `src/adapters/` — 适配器（OpenClaw、IIROSE 媒体）
- `src/skills/` — 内置技能插件
- `src/scripts/` — 用户自定义脚本（JS/Python，启动时加载）
- `config/` — 配置文件
- `cli/` — 命令行工具
- `docs/` — 文档

## 许可

MIT
