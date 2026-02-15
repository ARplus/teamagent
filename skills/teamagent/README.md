# TeamAgent Skill for Claude Code

> 让你的 Claude Code 成为 TeamAgent 平台上的智能协作 Agent

## 🎯 功能

- **自动领取任务** - Agent 自动领取分配给你的任务步骤
- **智能执行** - 简单任务自动执行，复杂任务请求人类决策
- **实时协作** - 通过 WebSocket 实时接收任务更新
- **任务建议** - Agent 智能建议下一步任务
- **无缝集成** - 与 TeamAgent Web 平台无缝配合

## 📦 安装

1. **复制 Skill 到 Claude Code**

```bash
# 复制整个 teamagent 文件夹到 Claude Code skills 目录
cp -r skills/teamagent ~/.claude/skills/
```

2. **配置 Skill**

```bash
# 启动 Claude Code
claude

# 运行配置命令
/teamagent config
```

你需要配置：
- `apiUrl`: TeamAgent 平台地址（如 `http://localhost:3000`）
- `apiToken`: 从 TeamAgent Settings 页面生成的 API Token
- `userId`: 你的用户 ID
- `workDirectory`: 工作目录（用于存放任务文件）

## 🚀 使用

### 连接到 TeamAgent

```
/teamagent
```

这会启动 Agent 工作循环，自动领取和执行任务。

### 查看状态

```
/ta-status
```

查看当前 Agent 状态和待处理任务。

### 手动领取任务

```
/ta-claim
```

手动领取一个可用的任务步骤。

### 建议下一步

```
/ta-suggest <taskId>
```

为已完成的任务智能建议下一步。

## 🔧 工作流程

```
1. TeamAgent 平台分配任务步骤给你
         ↓
2. Claude Code Skill 通过 WebSocket 收到通知
         ↓
3. Agent 判断是否可以自动执行
         ↓
4a. 简单任务 → 自动执行 → 提交结果
4b. 复杂任务 → 通知你 → 在 Web 界面决策
         ↓
5. 任务完成后，自动建议下一步
         ↓
6. 流转到下一个协作者
```

## 🛠 技术架构

- **WebSocket** - 实时任务推送
- **HTTP API** - 任务领取、提交、审批
- **Claude API** - AI 任务执行
- **本地文件系统** - 任务文件管理

## 📝 协议

详见 [PROTOCOL.md](./PROTOCOL.md)

## 🤝 贡献

欢迎提交 Issue 和 PR！

---

*Built with 🦞 by Aurora & Lobster*
