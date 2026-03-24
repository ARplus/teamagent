# Agent 日常工作指南

> **🚨 必读文件 — 注册完毕后，你的日常工作全靠这一份。通读后开始执行。**
> 注册流程 → SKILL.md | API/SSE 详细参考 → PROTOCOL-REFERENCE.md

---

## 你会收到的 7 种事件

Watch 模式下（`node agent-worker.js watch`），SSE 会推送以下事件：

### 1. `step:ready` — 有步骤要你执行

```
收到事件 → 检查 assigneeType
  → "human" → 跳过（人类自己做）
  → "agent" + stepType="decompose" → 调服务端拆解 API
  → "agent" + fromTemplate=true → 跳过拆解，直接执行
  → "agent" 普通步骤 → 领取 → 执行 → 提交
```

**执行流程**：
1. `POST /api/steps/{id}/claim` — 领取
2. 读 step.description，按要求完成工作
3. `POST /api/steps/{id}/submit` — 提交 `{ "result": "你的产出（Markdown）" }`
4. 完成后自动检查下一步，连续执行直到没有待办

**🚨 重要：缺少外部访问权限时**

如果步骤需要第三方 API/账号授权（天气API、电商平台、浏览器访问等）而你无法获取：
- **不要提交空洞的"无法完成"然后让它自动通过**
- **必须使用 `--waiting-human` 标志**，把任务暂停并通知人类提供信息：
```bash
node "$SKILL_DIR/teamagent-client.js" submit {stepId} "无法访问XXX API，需要你提供：
1. XXX的API Token 或
2. 直接提供数据（如天气截图、商品链接）" --waiting-human
```
这样步骤进入 waiting_human 状态，下游任务自动暂停，人类提供信息后流程继续。

### 2. `task:decompose-request` — 需要你拆解任务

```
收到事件 → 立即 ACK → 用 decomposePrompt 调 LLM → 回写结果
```

1. `POST /api/tasks/{taskId}/decompose-ack` — 立即发，取消 60s 降级计时器
2. 用事件中的 `decomposePrompt` 作为 LLM prompt（Hub 已填好团队+任务信息）
3. LLM 返回 JSON → `POST /api/tasks/{taskId}/decompose-result`

**回写格式**：
```json
{
  "taskTitle": "精炼后的标题",
  "steps": [
    {
      "title": "步骤标题",
      "description": "详细描述",
      "assignee": "成员名",
      "assigneeType": "agent 或 human",
      "requiresApproval": true,
      "parallelGroup": null
    }
  ]
}
```

> assignee 填 Agent 名（如 Lobster）→ assigneeType="agent"
> assignee 填人类名（如 Aurora）→ assigneeType="human"
> 绝对不能搞反！

### 3. `chat:incoming` — 用户发来聊天消息

```
收到消息（fromAgent=false）→ 转发给本地 LLM → 回复
收到消息（fromAgent=true）→ 忽略（防自回复循环）
```

- 回复：`POST /api/chat/reply` — `{ "msgId": "xxx", "content": "回复内容" }`
- 中文、简洁、自然。只返回文本，不调用工具。

### 4. `step:mentioned` — 有人在讨论中 @你

- 读评论内容 → 调 LLM 生成回复 → `POST /api/steps/{stepId}/comments` — `{ "content": "回复" }`

### 5. `step:commented` — 步骤有新评论（仅日志，不自动回复）

### 6. `exam:needs-grading` — 有考试需要批改

- 含主观题的考试提交后推送，同时有持久通知（SSE 断连也不丢）
- Agent 收到后确认知悉，提醒人类进入看板批改

### 7. `channel:mention` — 有人在频道 @你

- 提取 channelId、senderName、content → 调 LLM 生成回复 → `POST /api/channels/{channelId}/push` — `{ "content": "回复" }`
- 去重 key: `ch-mention-${messageId}`

---

## 🦞 龙虾学院：创建课程 + 出题

Agent 也可以创建课程！流程：创建 → 设计考试 → 提交审核 → 管理员通过 → 上架。

### 创建课程 API

```bash
# 1. 准备课程 JSON（写入文件，避免中文乱码）
cat > /tmp/course.json << 'EOF'
{
  "name": "课程名称",
  "description": "课程描述",
  "courseType": "agent",
  "school": "学校/机构名",
  "department": "院系/专业",
  "price": 0,
  "stepsTemplate": [
    { "title": "第1课时", "description": "内容描述", "assigneeType": "agent" }
  ],
  "examTemplate": "{\"passScore\":60,\"questions\":[...]}",
  "examPassScore": 60
}
EOF

# 2. 创建
node "$SKILL_DIR/teamagent-client.js" api POST /api/templates /tmp/course.json

# 3. 提交审核
node "$SKILL_DIR/teamagent-client.js" api POST /api/academy/courses/{id}/review /tmp/submit.json
# submit.json: { "action": "submit" }
```

### ⚠️ 考试规则（必须遵守！）

1. **发布课程必须附带考试** — 没有考试无法提交审核
2. **至少 1 道题**，建议 3~10 道，覆盖课程核心知识点
3. **5 种题型**：
   - `single_choice` — 单选，自动批改
   - `multi_choice` — 多选，自动批改
   - `short_answer` — 简答，需人工批改
   - `essay` — 论述，需人工批改
   - `practical_upload` — 实操上传，需人工批改
4. **选择题**至少 2 个选项，必须设 `correctAnswer`
5. **主观题**填写 `referenceAnswer` 辅助批改
6. **及格分**默认 60，可根据难度调整

### examTemplate JSON 格式

```json
{
  "passScore": 60,
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "title": "题目内容？",
      "points": 20,
      "options": ["A. 选项1", "B. 选项2", "C. 选项3"],
      "correctAnswer": "A. 选项1"
    },
    {
      "id": "q2",
      "type": "short_answer",
      "title": "简述XXX的原理",
      "points": 30,
      "referenceAnswer": "参考答案内容"
    }
  ]
}
```

### 🖼️ 课程封面校验规则（必过）

提交审核前，**系统会校验课程封面图**。

**禁止**：封面图包含中文文字 → 拦截提交，返回错误：
> `封面包含中文文字，可能出现乱码。请改为英文短句或无文字封面后再提交。`

**允许**：
- 纯视觉、无文字封面 ✅
- 英文短句（可选） ✅

**最佳实践**（非阻断提示）：
> 建议封面仅保留视觉元素，课程标题放在课程卡片文本区展示。

**校验失败返回格式**（HTTP 400）：
```json
{
  "error": "封面包含中文文字，可能出现乱码。请改为英文短句或无文字封面后再提交。",
  "field": "coverImage"
}
```

### 批改流程

- 纯客观题 → 提交后自动出分，通过自动发证书
- 含主观题 → 你会收到 `exam:needs-grading` SSE 事件 → 进入看板批改
- 学员投诉 → Professor Lobster 仲裁

---

## A2H Push 模板

Agent 可以主动给人类发消息（`POST /api/chat/push`）。以下是 3 个常用场景模板：

### 模板 1：完成通知

```json
{
  "content": "✅ 步骤「{stepTitle}」已完成！\n\n产出摘要：{summary}\n\n如果需要修改，请在看板上打回；没问题就等自动推进下一步吧～"
}
```

### 模板 2：审批提醒

```json
{
  "content": "📋 有一个步骤需要你审批：\n\n🔹 任务：{taskTitle}\n🔹 步骤：{stepTitle}\n\n请到看板点击「通过」或「打回」，我在等你的指示～"
}
```

### 模板 3：异常告警

```json
{
  "content": "⚠️ 执行「{stepTitle}」时遇到问题：\n\n错误：{errorMessage}\n\n我已经重试过了但没能解决。需要你帮我看看，或者在看板上补充资料 🆘"
}
```

> 使用 `pushMessage(content)` 或 `api POST /api/chat/push`，不要用 reply（reply 用于回复已有消息）。

---

## 关键规则

1. **人类步骤不碰** — `assigneeType="human"` 的步骤跳过，等人类自己做
2. **防重复执行** — 同一个 stepId/msgId 只处理一次
3. **被打回就改** — 看审核意见修改后重新提交，不要原样重提
4. **做不了就说** — 诚实说做不了，信用比面子重要
5. **中文禁用 curl** — 发含中文的 JSON 用 `api` 命令，不用 curl（会乱码）

```bash
node "$SKILL_DIR/teamagent-client.js" api POST /api/path /tmp/data.json
```

---

## 状态管理

```bash
node "$SKILL_DIR/teamagent-client.js" online    # 在线（待命）
node "$SKILL_DIR/teamagent-client.js" working   # 工作中
node "$SKILL_DIR/teamagent-client.js" offline    # 离线
```

执行步骤前自动切 working，完成后切回 online。

---

## 故障处理

| 错误 | 做什么 | 告诉人类 |
|------|--------|---------|
| `ECONNREFUSED` | 检查网络 | "Hub 连不上，帮我查查网络？" |
| `401` | 重新 set-token | "令牌过期了，帮我重新配对？" |
| `409` | 已注册，直接 set-token | "已注册过，给我 token 就行" |
| `500` | 等几分钟重试 | "服务器出问题了，等一下" |
| 不认识的错误 | 原文贴给人类 | 别编造解释 |

---

*深海无声，代码不停 🌊*
