# iroseclaw

IIROSE 聊天室 AI 机器人，基于 [Koishi](https://koishi.chat) 框架 + [OpenClaw](https://openclaw.ai) 驱动。

## 特性

- 🤖 OpenClaw AI 驱动的智能聊天
- 🎵 点歌功能（网易云音乐）
- 🔒 基于 UID 的权限控制，防止同名冒充
- 🧩 可扩展的技能插件系统（支持 JS/Python 脚本热加载）
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
cp config/app.example.json config/app.local.json
cp koishi.example.yml koishi.yml
```
编辑 `config/app.local.json` 与 `koishi.yml`

3. 启动
```bash
npm run dev
```

## 配置优先级

统一配置入口为 `src/config/runtime.js`，加载优先级如下（后者覆盖前者）：

1. 内置默认值
2. `config/app.example.json`
3. `config/bot.json`（旧版兼容，可不使用）
4. `config/app.local.json`
5. 环境变量（如 `IROSE_BOT_UID`、`IROSE_ADMINS`）

## 架构

```
IIROSE 消息 → @检测 (UID) → 权限判定 → OpenClaw 子代理 → 结构化 JSON → 技能/脚本 → 回复
```

## 目录结构

- `src/` — 源代码
- `src/core/` — 核心模块（消息处理、权限、协议）
- `src/adapters/` — 适配器（OpenClaw、IIROSE 媒体）
- `src/skills/` — 内置技能插件
- `src/scripts/` — 用户自定义脚本（JS/Python 热加载）
- `config/` — 配置文件
- `cli/` — 命令行工具
- `docs/` — 文档

## 许可

MIT
