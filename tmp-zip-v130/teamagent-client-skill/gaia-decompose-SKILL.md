---
name: gaia-decompose
description: Gaia 任务拆解 Skill。主 Agent 专用：将任务拆解为步骤并分配给团队成员。
homepage: https://agent.avatargaia.top
metadata: {"clawdbot":{"emoji":"🔀","requires":{"skills":["gaia-core"]}}}
---

# Gaia Decompose — 任务拆解（主 Agent 专用）

> 收到任务 → 分析 → 拆成步骤 → 分配给对的人/Agent → 提交

---

## 什么时候触发

| 场景 | 触发方式 | 你要做什么 |
|------|---------|-----------|
| Solo 模式，人类点「主Agent拆解」 | SSE `step:ready` + stepType=decompose | 调用 execute-decompose |
| Team 模式，人类点「AI拆解」 | SSE `task:decompose-request` | ACK → 本地拆解 → 回写 |

---

## 路径一：Solo 模式

```
SSE: step:ready { stepType: "decompose", taskDescription: "..." }
  ↓
agent-worker.js 自动调用 POST /api/steps/{id}/execute-decompose
  ↓
服务端用 LLM 拆解 → 创建步骤 → 通知 assignee
```

agent-worker 已自动处理，无需手动干预。

---

## 路径二：Team 模式

```
SSE: task:decompose-request {
  taskId, taskTitle, taskDescription, supplement?,
  teamMembers: [{ name, isAgent, agentName?, capabilities?, soulSummary?, level? }]
}
  ↓
1. 立即 ACK：POST /api/tasks/{taskId}/decompose-ack（取消 60s 降级计时器）
2. 分析任务 + 团队能力 → 生成步骤 JSON
3. 回写：POST /api/tasks/{taskId}/decompose-result
```

### 超时机制
- 60s 内未 ACK → Hub 自动降级到千问 API 拆解
- 主 Agent 不在线 → 直接千问，不等待

---

## 拆解 Prompt（标准化）

> 以下 prompt 供 agent-worker.js 的 decompose-handler 使用。修改此处即可调整拆解行为，无需改代码。

### 团队信息格式化

对 teamMembers 中每个成员：
- 有 Agent → `👤 人类「{humanName}」└─ 🤖 Agent「{agentName}」— 能力：{capabilities}`
- 无 Agent → `👤 人类「{name}」（无Agent，只能人工执行）`

### 核心拆解规则

1. **身份严格区分**（最重要！）
   - Agent 自动执行 → assignee 填 **Agent名**，assigneeType = `"agent"`
   - 人类亲自操作 → assignee 填 **人类名**，assigneeType = `"human"`
   - ⛔ 绝对禁止混填

2. **审批设置**
   - 关键决策、最终产出 → `requiresApproval: true`
   - 常规执行步骤 → `requiresApproval: false`

3. **并行分组**
   - 可同时做的步骤 → `parallelGroup: "相同名"`
   - 有先后依赖的 → `parallelGroup: null`

4. **最少 2 步**，逻辑清晰，每步独立可执行

5. **taskTitle 精炼**：去掉"请帮我""我想要"等口水前缀，2-50 字

6. **军团注册特殊规则**：涉及"组建军团"时必须拆为两步——API注册 + OpenClaw创建（详见 gaia-core）

### 输出格式

```json
{
  "taskTitle": "精炼后的标题",
  "steps": [
    {
      "title": "步骤名",
      "description": "详细描述（Markdown）",
      "assignee": "成员名字",
      "assigneeType": "agent",
      "requiresApproval": true,
      "parallelGroup": null,
      "inputs": ["依赖物"],
      "outputs": ["产出物"],
      "skills": ["技能标签"],
      "stepType": "task"
    }
  ]
}
```

---

## 回写 API

### `POST /api/tasks/{id}/decompose-result`

```json
{
  "steps": [...],
  "reasoning": "拆解理由（可选）",
  "taskTitle": "重写标题（可选）"
}
```

| 状态码 | 含义 |
|--------|------|
| 200 | 成功，步骤已创建 |
| 400 | 步骤列表为空 |
| 409 | 已完成或正在降级（幂等保护） |

---

## 命令行

```bash
# 一次性处理所有待拆解步骤
node {SKILL_DIR}/agent-worker.js decompose

# 实时监听（含拆解自动处理）
node {SKILL_DIR}/agent-worker.js watch
```

---

## 拆解质量标准

- [ ] assignee 和 assigneeType 严格匹配
- [ ] 每个步骤有清晰的 description
- [ ] 产出物是具体文件名（如 `报告.md`），不是"一份报告"
- [ ] 并行分组合理（无依赖的放同组）
- [ ] 关键步骤 requiresApproval=true

---

*任务拆解：把大象装冰箱，一步一步来 🔀*
