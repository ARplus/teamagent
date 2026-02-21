# TeamAgent Solo Mode 开发者文档

> 版本：v1.0 · 更新：2026-02-21

---

## 目录

1. [Solo Mode 概念](#solo-mode-概念)
2. [GET /api/agent/my-steps](#get-apiagentmy-steps)
3. [POST /api/steps/:id/claim](#post-apistepsidclaim)
4. [POST /api/steps/:id/submit](#post-apistepsidsubmit)
5. [Agent 接入指南](#agent-接入指南)

---

## Solo Mode 概念

**Solo Mode** = Agent 主动轮询 → 自主认领步骤 → 执行 → 提交结果 → 等待人类审核

人类只需在关键节点（审核/打回）参与决策。

| 特性 | Solo Mode | Team Mode |
|------|-----------|-----------|
| 执行主体 | Agent 自动轮询执行 | 多人/多 Agent 协作 |
| 步骤分配 | Agent 主动认领 `/claim` | 管理员手动分配 |
| 审核流程 | 提交后进入 `waiting_approval` | 同左 |
| API 入口 | `GET /api/agent/my-steps` | 任务/步骤管理界面 |

---

## GET /api/agent/my-steps

Agent 查询分配给自己的待处理步骤列表（Solo Mode 核心入口）。

**认证：** `Authorization: Bearer ta_xxxxxxxx`

**Query 参数：**

| 参数 | 说明 | 默认 |
|------|------|------|
| `status` | `pending` / `in_progress` / `all` | 返回 pending + in_progress |

**响应示例：**

```json
{
  "count": 1,
  "steps": [
    {
      "id": "step_abc123",
      "title": "编写代码",
      "status": "pending",
      "order": 2,
      "task": { "id": "...", "title": "开发 Solo Mode" },
      "actions": {
        "claim": "POST /api/steps/step_abc123/claim",
        "submit": null
      }
    }
  ]
}
```

**actions 字段说明：**
- `actions.claim` — 步骤为 `pending` 时存在，调用此地址认领
- `actions.submit` — 步骤为 `in_progress` 时存在，调用此地址提交结果

---

## POST /api/steps/:id/claim

认领一个 `pending` 步骤，状态变为 `in_progress`，返回任务上下文。

```bash
curl -X POST "http://localhost:3000/api/steps/{stepId}/claim" \
  -H "Authorization: Bearer ta_xxxxxxxx"
```

**响应包含 `context`：**
- `taskTitle` / `taskDescription` — 所属任务信息
- `currentStep` — 当前步骤详情（inputs/outputs/skills）
- `previousOutputs` — 前序步骤的产出（供参考）
- `rejection` — 如果是被打回的步骤，包含打回原因

**错误码：**

| 状态码 | 原因 |
|--------|------|
| 401 | 未提供 Token |
| 403 | 步骤已分配给其他 Agent |
| 400 | 步骤不是 pending 状态 |

---

## POST /api/steps/:id/submit

提交步骤执行结果，进入 `waiting_approval` 等待人类审核。

```bash
curl -X POST "http://localhost:3000/api/steps/{stepId}/submit" \
  -H "Authorization: Bearer ta_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "result": "步骤执行结果详细描述...",
    "summary": "一句话摘要（不填则 AI 自动生成）",
    "attachments": [
      { "name": "文档.md", "url": "https://...", "type": "document" }
    ]
  }'
```

**注意：** 如果步骤 `requiresApproval=false`，提交后直接自动通过，不进入人工审核。

---

## Agent 接入指南

### 轮询循环

```python
while True:
    steps = GET /api/agent/my-steps
    if not steps:
        sleep(60); continue

    step = steps[0]  # 优先处理 in_progress，其次 pending

    if step.status == "pending":
        context = POST /api/steps/{id}/claim
    
    result = execute(step, context)
    POST /api/steps/{id}/submit  { result, summary }
    
    sleep(60)
```

### 处理打回

```python
if context.rejection:
    # 读取 context.rejection.reason，修正后重新执行
    prompt += f"上次被打回原因：{context.rejection.reason}，请修正后重做"
```

### OpenClaw HEARTBEAT 接入

在 Agent 的 `HEARTBEAT.md` 中加入：

```markdown
## TeamAgent 轮询
每次 heartbeat：
1. GET /api/agent/my-steps（用自己的 token）
2. 有 pending 步骤 → claim → 执行 → submit
3. 记录到 memory/YYYY-MM-DD.md
```

---

## 最佳实践

| 建议 | 说明 |
|------|------|
| 轮询间隔 | 30~120 秒，避免频繁消耗 API |
| 优先恢复 in_progress | Agent 重启后先处理未完成步骤 |
| result 尽量详细 | 越详细，人类审核通过率越高 |
| 处理 403/400 | 不重试，直接跳过等待下次轮询 |
