# gaia-task.md — 任务执行专项

本文件涵盖任务查看、步骤领取、提交、拆解等所有任务相关操作。

---

## 查看与领取任务

### 查看我的任务列表
```bash
node teamagent-client.js tasks
```

### 查看可领取的步骤
```bash
node teamagent-client.js available
```

### 领取步骤
```bash
node teamagent-client.js claim {stepId}
```

---

## 提交步骤

### 普通提交（完成）
```bash
# 将结果写入 JSON 文件，再用 api 命令发送（禁止 curl 中文）
cat > /tmp/submit.json << 'EOF'
{
  "result": "这里写执行结果，支持中文",
  "status": "done"
}
EOF
node teamagent-client.js api POST /api/steps/{stepId}/submit /tmp/submit.json
```

### 等待外部权限时提交
当步骤需要等待人类操作（如人工审核、外部系统授权）时，使用 `waiting_human` 状态：

```bash
cat > /tmp/submit-wait.json << 'EOF'
{
  "result": "已发起申请，等待外部系统审批",
  "status": "waiting_human"
}
EOF
node teamagent-client.js api POST /api/steps/{stepId}/submit /tmp/submit-wait.json
```

**必须用 `waiting_human` 的场景：**
- 需要人类在第三方系统操作
- 需要等待审批流程完成
- 步骤依赖外部 API 回调

### 提交并追加子步骤（step-append）
pre_check 步骤提交时，可在 result 中附 `extraSteps` JSON，系统自动追加到任务末尾：

```bash
cat > /tmp/submit-extra.json << 'EOF'
{
  "result": "已读取任务，执行计划如下：\n1. 完成数据分析\n2. 输出报告\n3. 等待审核",
  "status": "done",
  "extraSteps": [
    {
      "title": "数据分析",
      "description": "分析提供的数据集，输出统计摘要",
      "assigneeType": "agent",
      "order": 10
    },
    {
      "title": "输出报告",
      "description": "根据分析结果撰写报告",
      "assigneeType": "human",
      "order": 11
    }
  ]
}
EOF
node teamagent-client.js api POST /api/steps/{stepId}/submit /tmp/submit-extra.json
```

---

## 步骤串行队列

同时收到多个 `step:ready` 事件时，**不要并行处理**，按以下规则排队：

1. 收到事件后先记录 stepId 到队列
2. 完成当前步骤提交后，再处理下一个
3. 每次只持有一个 `claimed` 状态的步骤
4. 避免并发提交导致顺序混乱

---

## 任务拆解

收到 `task:decompose-request` 事件时，读取任务内容，调用 LLM 拆解成步骤列表，再提交：

```bash
# 将拆解结果写入文件
cat > /tmp/decompose.json << 'EOF'
{
  "steps": [
    {
      "title": "需求分析",
      "description": "分析用户需求，明确目标和范围",
      "assigneeType": "agent",
      "requiresApproval": false,
      "order": 1
    },
    {
      "title": "方案设计",
      "description": "根据需求设计实现方案",
      "assigneeType": "agent",
      "requiresApproval": true,
      "order": 2
    },
    {
      "title": "验收确认",
      "description": "人类对最终结果进行确认",
      "assigneeType": "human",
      "requiresApproval": false,
      "order": 3
    }
  ]
}
EOF
node teamagent-client.js api POST /api/tasks/{taskId}/decompose-ack /tmp/decompose.json
```

---

## 步骤状态流转

```
in_progress
  ├─→ done              （完成，触发下一步解锁）
  ├─→ waiting_human     （等待外部操作，暂停）
  └─→ waiting_approval  （提交后等人类审批，requiresApproval=true 时自动进入）
```

审批步骤：人类 approve 后自动解锁后续步骤；reject 后步骤回到 in_progress，重新执行。

---

## 常见错误

| 错误 | 原因 | 处理 |
|------|------|------|
| `Step not assigned to you` | 未领取就直接提交 | 先 `claim` 再 `submit` |
| `Step already completed` | 重复提交 | 忽略，检查下一步 |
| `Task not found` | taskId 错误 | 从 `tasks` 命令重新获取 |
