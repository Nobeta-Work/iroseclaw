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

## AI 个性化配置

机器人“个性化”相关配置分为 4 层：

1. 房间展示签名（IIROSE 资料签名）
- 文件：`koishi.yml`
- 字段：`plugins.koishi-plugin-adapter-iirose:iirose.signature`
- 用途：显示在机器人资料页，不直接控制 AI 对话语气。

2. OpenClaw 子代理选择
- 文件：`config/app.json`（统一由 `src/config/runtime.js` 加载）
- 字段：`openclaw.subagentLabel`
- 环境变量覆盖：`IROSE_OPENCLAW_SUBAGENT`
- 用途：指定聊天时调用哪个 OpenClaw agent。

2.1 OpenClaw 调用边界
- 字段：`openclaw.stateless`
- 默认值：`true`
- 用途：将 OpenClaw 作为近似普通 AI provider 使用，默认每次请求走隔离 session，不复用 agent 会话记忆。
- 只有在明确需要依赖 OpenClaw 原生会话上下文时，才应关闭它并配合 `openclaw.useNativeSessionContext=true` 使用。

3. 对话语气/人格（核心）
- 文件：`~/.openclaw/agents/<subagentLabel>/agent/config.json`
- 字段：`systemPrompt`
- 用途：控制语气、风格、回复长度、角色设定等。

4. 失败兜底回复词条
- 文件：`config/app.json`
- 字段：`fallbackResponses`
- 用途：当 OpenClaw 无法返回有效文本时，随机返回兜底文案。

说明：失败类兜底回复已统一收敛到 `fallbackResponses`（含 OpenClaw 失败、无回复、技能执行异常、消息处理异常）。权限提示和限流提示等业务文案仍独立定义。

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

## 音乐 Provider 说明

当前点歌链路已支持可配置的播放源 provider 链，用于将“搜歌元数据”和“最终播放地址”解耦。

- 默认 provider 顺序：`iarcDirect -> metingRedirect -> neteaseOuter`
- 搜索与详情：仍由当前 bot 侧实现负责
- 播放地址：由 provider 决定

关于 `iarcDirect`：

- 参考项目：<https://github.com/jingming295/IIROSE-MEDIA-WEB>
- 当前实现只参考了该项目中公开可见的第三方播放地址模式：
  - `https://v.iarc.top/?type=url&id={{id}}#.mp3`
- 当前实现**没有**引入或执行该项目的其他核心代码，包括但不限于：
  - 前端 UI
  - DOM/iframe 注入逻辑
  - WebSocket 发送器
  - localStorage 设置逻辑
  - 加密搜索/详情请求实现
  - 其他客户端插件内部逻辑

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
- `openclaw.*`
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
IIROSE 消息 → @检测 (UID) → 权限判定 → OpenClaw 子代理 → 结构化 JSON → 技能/脚本 → 回复
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
