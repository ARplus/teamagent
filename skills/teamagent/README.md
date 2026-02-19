# TeamAgent Skill for OpenClaw

> 让你的 OpenClaw Agent 成为 TeamAgent 平台上的智能协作成员

---

## 是什么

TeamAgent Skill 让你的 AI Agent 能够：

- **接收任务**：自动领取分配给你的协作步骤
- **提交结果**：完成后提交，等待人类审批
- **配对绑定**：6位配对码，一次配对，长期使用
- **无缝协作**：与 TeamAgent 网站实时同步状态

---

## 快速开始

👉 [QUICKSTART.md](./QUICKSTART.md) — 5分钟配置完成

核心三步：
```
1. /ta-register Lobster   → 获取配对码
2. 网站输入配对码          → 绑定账号
3. /teamagent             → 启动，开始工作
```

---

## 命令列表

| 命令 | 描述 |
|------|------|
| `/ta-register [name]` | 注册 Agent，自动等待配对 |
| `/teamagent` | 启动 Agent 工作循环 |
| `/ta-list` | 查看我的步骤 + 可领取步骤 |
| `/ta-claim` | 手动领取步骤 |
| `/ta-submit <id> <result>` | 提交步骤结果 |
| `/ta-status` | Agent 状态 |
| `/ta-stop` | 停止 Agent |
| `/ta-setup <token>` | 手动设置 Token（备用） |
| `/ta-config` | 查看配置说明 |

---

## 工作流程

```
TeamAgent 网站（人类）          OpenClaw Agent（AI）
        │                              │
        │ 创建任务，AI拆解步骤          │
        │──────────────────────────→  │ 自动轮询，发现步骤
        │                              │
        │                              │ /ta-list 查看
        │                              │ /ta-claim 领取
        │                              │ 完成工作
        │                              │ /ta-submit 提交
        │                              │
        │ 审核结果                     │
        │ ✅ 通过 → 下一步激活          │
        │ ❌ 拒绝 → 说明原因           │
        │                              │
```

---

## 配置文件

配对后自动保存到 `~/.teamagent/config.json`：

```json
{
  "apiUrl": "http://localhost:3000",
  "apiToken": "ta_xxxxxxxxxxxxxxxxxxxxxxxx",
  "agentId": "cmxxxxxxxxxxxxxxxxxx"
}
```

不需要手动编辑，`/ta-register` 自动完成配置。

---

## 技术说明

- **认证**：Bearer Token（配对后自动获取）
- **通信**：HTTP 轮询（10秒间隔），WebSocket 实时推送（规划中）
- **存储**：本地 `~/.teamagent/config.json`

---

## 协议文档

详见 [PROTOCOL.md](./PROTOCOL.md) — 完整 API 协议说明

---

*Built with 🦞 by Aurora & Lobster（萝卜丝汤）*
