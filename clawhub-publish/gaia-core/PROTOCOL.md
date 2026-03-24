# TeamAgent 任务拆解与执行协议 v2.2

> 核心协议：定义任务如何被拆解、分配、执行和审核，以及所有 SSE 事件的完整规范。
> v2.2 新增：模版零拆解直执行（`fromTemplate`）、`executionProtocol` 机制、人机协作字段、未分配步骤、Skill Registry、**Decompose Prompt 外置**（Hub 端构建填充好的拆解 prompt 随 SSE 事件下发）
> v2.1 新增：Team 模式 `task:decompose-request` 事件、`assigneeType` 字段、完整 SSE 事件表、`fromAgent` 标识

---

## 一、任务模式

| mode | 含义 | 拆解方式 |
|------|------|----------|
| `solo` | 内部任务，用户+自己的AI团队 | **主Agent拆解**（通过 `step:ready` + `stepType=decompose`）|
| `team` | 多人协作 | **主Agent拆解**（通过 `task:decompose-request` SSE 事件）→ 60s 超时降级千问 |

---

## 二、步骤格式（v2.2）

```json
{
  "title": "步骤标题",
  "description": "详细描述（Markdown）",
  "assignee": "成员名字（Agent名 或 人名，单值）",
  "assigneeType": "agent",
  "requiresApproval": true,
  "parallelGroup": null,
  "inputs": ["输入依赖"],
  "outputs": ["产出物，文件写文件名如 报告.md"],
  "skills": ["需要的技能"],
  "stepType": "task",
  "parentStepId": null,
  "needsHumanInput": false,
  "humanInputPrompt": null,
  "unassigned": false,
  "unassignedReason": null,
  "fallbackSkills": []
}
```

### 字段说明

**assignee**（string）
- 单个成员名字，匹配团队成员列表
- Agent → 填 Agent 名字（如 "Lobster"、"八爪"）
- 人类 → 填人名（如 "Aurora"、"木须"）

**assigneeType**（`"agent"` | `"human"`）
- `"agent"` = 分配给 Agent 自动执行
- `"human"` = 分配给人类手动提交
- ⚠️ **必须与 assignee 匹配**：Agent 名 → `"agent"`，人名 → `"human"`

**requiresApproval**（bool）
- `true` = 步骤完成后需人类审批才能继续（关键决策、最终产出）
- `false` = 完成后自动流转（常规执行步骤）

**parallelGroup**（string | null）
- `null` = 顺序执行
- 相同字符串（如 `"调研"`）= 同组步骤可以**同时并行执行**

**stepType**
- `task` = 普通执行步骤（默认）
- `meeting` = 会议步骤（需填 participants + agenda）
- `decompose` = 拆解步骤（系统内部使用，Solo 模式）

**parentStepId**（string | null）— v2.2 新增
- 步骤动态展开时，指向父步骤 ID
- `null` = 顶级步骤（默认）

**needsHumanInput**（bool）— v2.2 新增
- `true` = 此步骤需要人类补充资料后 Agent 才能继续执行
- `false` = 无需人类输入（默认）

**humanInputPrompt**（string | null）— v2.2 新增
- 当 `needsHumanInput=true` 时，提示人类需要提供什么信息
- 例："请提供竞品列表和目标市场定义"

**unassigned**（bool）— v2.2 新增
- `true` = 步骤尚未分配（高亮显示，等待手动分配或自动匹配）
- `false` = 已分配（默认）

**unassignedReason**（string | null）— v2.2 新增
- 当 `unassigned=true` 时，说明未分配原因
- 例："团队中无匹配 '视频剪辑' 技能的成员"

**fallbackSkills**（string[]）— v2.2 新增
- 备选技能列表，当首选 Skill 不可用时尝试匹配
- 用于模版步骤的弹性分配

---

## 三、Solo 模式主Agent拆解流程

> Solo 模式使用 `step:ready` + `stepType=decompose` 机制

```
用户创建 Solo 任务（不传 steps）
    ↓
服务器检测 task.mode === 'solo' + 创建者有 isMainAgent=true 的 Agent
    ↓ 是
创建 stepType='decompose' 步骤，分配给创建者的主Agent
SSE 通知主Agent → step:ready { stepType: "decompose", taskDescription: "...", decomposePrompt?: "填充好的拆解prompt" }
    ↓
主Agent 收到通知
→ 认领步骤（POST /api/steps/{id}/claim）
→ 如有 decomposePrompt → 直接用作 LLM system prompt（Hub 已填充团队+任务信息）
→ 如无 decomposePrompt → 获取团队成员能力（GET /api/agents/team）+ 本地构建 prompt
→ 调用本地 LLM 生成步骤 JSON
→ 提交（POST /api/steps/{id}/submit，result = JSON数组字符串）
    ↓
服务器检测 stepType=decompose 提交
→ 解析 JSON → 批量创建 TaskStep
→ 按 assignee 名字匹配 userId
→ 按 assigneeType 区分人类/Agent
→ parallelGroup 相同的步骤同时设为 pending
→ 通知各 assignee（step:ready）
→ decompose 步骤自动标为 done
    ↓ 无主Agent
提示用户「请先配对并绑定主Agent」
```

## 四、Team 模式拆解流程

> Team 模式使用 `task:decompose-request` SSE 事件 + `/api/tasks/{id}/decompose-result` 回写 API

```
用户点「AI 拆解」（task.mode === 'team'）
    ↓
服务器检查创建者的主Agent是否在线（status = online/working）
    ↓ 在线
标记 decomposeStatus = 'pending'
SSE 推送给主Agent → task:decompose-request {
  taskId, taskTitle, taskDescription, supplement?,
  teamMembers: [{ name, isAgent, agentName?, capabilities?, role?, soulSummary?, level? }],
  decomposePrompt?: "Hub 填充好的拆解 prompt（含团队+任务信息）"
}
    ↓
主Agent 收到事件
→ 立即 ACK：POST /api/tasks/{taskId}/decompose-ack（取消 60s 降级计时器）
→ 如有 decomposePrompt → 直接用作 LLM system prompt（无需本地拼 prompt）
→ 如无 decomposePrompt → 用 teamMembers 本地构建 prompt（向后兼容）
→ 调用本地 LLM 生成步骤 JSON
→ 回写结果：POST /api/tasks/{taskId}/decompose-result
  Body: { steps: [...], reasoning?: "拆解理由", taskTitle?: "可选重写标题" }
    ↓
服务器收到回写
→ 幂等检查：decomposeStatus 必须是 "pending"（防止超时降级后重复写入）
→ 批量创建步骤 → 通知各 assignee
→ 标记 decomposeStatus = 'done', decomposeEngine = 'main-agent'
→ 广播 task:parsed 事件

    ↓ 主Agent不在线 或 60s超时未回写
自动降级到千问API（hub-llm）拆解
→ 标记 decomposeStatus = 'fallback'
```

### Decompose Prompt 外置（v2.2 新增）

> Hub 端存储默认拆解 prompt 模板，填充好团队信息+任务描述后，随 SSE 事件下发给 Agent。
> Agent 收到 `decomposePrompt` 字段后**直接用作 LLM system prompt**，无需本地拼装。

**优先级**：
1. 工作区级覆盖：`Workspace.settings` JSON 中的 `decomposePrompt` 字段
2. 系统默认模板：Hub 内置（含 `{{taskTitle}}`、`{{taskDescription}}`、`{{supplement}}`、`{{formattedTeamMembers}}` 占位符）

**Agent 端处理逻辑**：
```
收到 SSE 事件（step:ready 或 task:decompose-request）
    ↓ 检查 decomposePrompt 字段
有值 → 直接用作 LLM system prompt，调 LLM 生成步骤 JSON
无值 → 本地构建 prompt（向后兼容，用 teamMembers + 本地模板）
```

---

## 四·五、模版零拆解直执行流程（v2.2 新增）

> 模版（TaskTemplate）预定义了 `executionProtocol` + `stepsTemplate`，运行时步骤的 `description` 已是完整指令，Agent 无需拆解直接执行。

```
运行模版: POST /api/templates/{id}/run
  Body: { variables: { key: value }, priority?, overrideSteps? }
    ↓
服务器 instantiateSteps():
  ① executionProtocol 预置到每个步骤 description 头部
  ② promptTemplate 中的 {{变量}} 替换为实际值
  ③ 创建 Task (decomposeStatus='done', decomposeEngine='template')
  ④ 批量创建 TaskStep
    ↓
activateAndNotifySteps() 推送:
  SSE → step:ready { stepId, title, fromTemplate: true, templateName? }
    ↓
agent-worker 收到 step:ready (fromTemplate=true)
  → 跳过拆解，直接 executeStep()
  → step.description 就是完整执行指令
  → 认领 → 执行 → 提交结果
    ↓
后续步骤按 parallelGroup 自动激活
```

### 关键概念

**executionProtocol**（string）
- 模版级别的执行方法论/规范文本
- `instantiateSteps()` 时会拼接到每个步骤 `description` 的头部
- 例："# 执行规范\n- 所有输出使用中文\n- 代码附带单元测试"

**promptTemplate**（string）
- 步骤模板中的指令模板，支持 `{{变量名}}` 占位符
- 运行时替换为用户提供的 `variables` 值
- 例："分析 {{公司名}} 在 {{行业}} 领域的竞争态势"

**fromTemplate 标识**
- `step:ready` 事件携带 `fromTemplate: true`
- agent-worker 据此跳过拆解，直接执行 step
- 去重 key: `tpl-step-{stepId}`

### `POST /api/tasks/{id}/decompose-result` 请求体

```json
{
  "steps": [
    {
      "title": "步骤标题",
      "description": "详细描述",
      "assignee": "成员名字",
      "assigneeType": "agent",
      "requiresApproval": true,
      "parallelGroup": "调研",
      "inputs": ["依赖物"],
      "outputs": ["产出物"],
      "skills": ["技能"],
      "stepType": "task",
      "agenda": "会议议题（meeting 类型时）",
      "participants": ["参会者（meeting 类型时）"]
    }
  ],
  "reasoning": "可选：拆解理由说明",
  "taskTitle": "可选：Agent 可重写任务标题（2-100字）"
}
```

### 响应

| 状态码 | 含义 |
|--------|------|
| 200 | `{ message, stepsCreated, engine: "main-agent" }` |
| 400 | `{ error: '步骤列表不能为空' }` |
| 409 | `{ error: '任务拆解已完成或正在降级处理中', currentStatus }` |

---

## 五、拆解输出示例

```json
[
  {
    "title": "文献调研",
    "description": "调研相关领域已发表论文",
    "assignee": "Galileo",
    "assigneeType": "agent",
    "requiresApproval": false,
    "parallelGroup": "调研",
    "outputs": ["文献报告.md"],
    "skills": ["文献检索"]
  },
  {
    "title": "用户访谈",
    "description": "联系3位目标用户进行电话访谈",
    "assignee": "Aurora",
    "assigneeType": "human",
    "requiresApproval": true,
    "parallelGroup": "调研",
    "outputs": ["访谈记录.md"]
  },
  {
    "title": "综合评估报告",
    "description": "综合以上输出，给出结论",
    "assignee": "Quill",
    "assigneeType": "agent",
    "requiresApproval": true,
    "parallelGroup": null,
    "inputs": ["文献报告.md", "访谈记录.md"],
    "outputs": ["评估报告.md"]
  }
]
```

---

## 六、SSE 事件完整规范

### 连接方式

```
GET /api/agent/subscribe
Authorization: Bearer ta_xxx
Accept: text/event-stream
Last-Event-ID: {可选，用于断线重连恢复}
```

### 连接建立后的初始事件

```json
{ "type": "connected", "agentId": "xxx", "agentName": "Lobster", "message": "🦞 已连接到 TeamAgent" }
```

如果有 `Last-Event-ID`，服务器会补发遗漏的 `chat:incoming` 消息（`catchup: true`）。

### 心跳

每 30 秒发送 `{ "type": "ping" }`，客户端断线后 5 秒自动重连。

---

### 事件类型一览表

#### 任务生命周期

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `task:created` | 任务创建成功 | `{ taskId, title }` |
| `task:updated` | 任务状态变更 | `{ taskId, title }` |
| `task:decomposed` | Solo 模式 decompose 步骤提交后步骤展开完成 | `{ taskId, stepsCount }` |
| `task:parsed` | Team 模式 / Hub-LLM 拆解完成 | `{ taskId, stepCount, engine }` |

#### 拆解请求（Team 模式）

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `task:decompose-request` | Team 模式拆解请求推送给在线主Agent | `{ taskId, taskTitle, taskDescription, supplement?, teamMembers[], decomposePrompt? }` |

`teamMembers` 每项结构：
```json
{
  "name": "成员显示名",
  "isAgent": true,
  "agentName": "Agent名字（isAgent=true时）",
  "capabilities": ["能力标签"],
  "role": "角色",
  "soulSummary": "SOUL.md摘要",
  "level": 3
}
```

#### 步骤流转

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `step:ready` | 步骤就绪可认领 | `{ taskId, stepId, title, stepType?, taskDescription?, decomposePrompt?, fromTemplate?, templateName? }` |
| `step:assigned` | 步骤被分配 | `{ taskId, stepId, title }` |
| `step:completed` | 步骤完成（自动通过） | `{ taskId, stepId, title, nextStepId? }` |
| `step:human-input-provided` | 人类补充资料完成（v2.2） | `{ taskId, stepId, title }` |

> ⚠️ `step:ready` 有去重机制：同一 agentId 的多个连接只推送给最新连接，防止重复 claim。

#### 审批流

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `approval:requested` | 步骤提交等待审核 | `{ taskId, stepId, title }` |
| `approval:granted` | 步骤审核通过 | `{ taskId, stepId }` |
| `approval:rejected` | 步骤被打回 | `{ taskId, stepId, reason? }` |

#### 申诉

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `step:appealed` | Agent 对打回提出申诉 | `{ taskId, stepId, title, appealText }` |
| `appeal:resolved` | 申诉裁决 | `{ taskId, stepId, decision: 'upheld'|'dismissed', note? }` |

#### 评论与 @提及

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `step:commented` | 步骤下有新评论 | `{ taskId, stepId, commentId, authorName }` |
| `step:mentioned` | 评论中 @提及了你 | `{ taskId, stepId, commentId, authorId, authorName, content }` |

> ⚠️ `step:mentioned` 只推送给被 @到的用户，`content` 是评论全文。Agent 收到后应阅读内容并回复。

#### 聊天消息

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `chat:incoming` | 收到聊天消息 | `{ msgId, content, agentId }` |
| `chat:incoming`（Agent回复） | Agent push/reply 消息 | `{ msgId, content, agentId, fromAgent: true }` |

> ⚠️ **`fromAgent: true` 标识**：当 `chat:incoming` 带有 `fromAgent: true` 时，表示这条消息是 Agent 自己发出的（通过 push 或 reply）。agent-worker 必须忽略此类事件，防止自回复死循环。

#### Agent 呼叫（紧急通知）

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `agent:calling` | Agent 发起紧急呼叫 | `{ callId, priority, title, content, agentName, taskId?, stepId? }` |
| `agent:call-responded` | 人类响应呼叫 | `{ callId, action, message?, respondedBy }` |

`priority` 取值：`"urgent"` | `"normal"` | `"low"`

#### 成长与评测

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `agent:level-up` | Agent 经验值升级 | `{ agentId, newLevel, oldLevel, totalXP }` |
| `task:evaluating` | 开始评测 Agent 表现 | `{ taskId, title, agentName }` |
| `task:evaluated` | 评测完成 | `{ taskId, title, count, reviewerName? }` |

#### 工作流

| 事件 | 触发时机 | 载荷 |
|------|----------|------|
| `workflow:changed` | 任务工作流变更 | `{ taskId, change }` |

---

## 七、Skill 命令（agent-worker.js）

```bash
node agent-worker.js check          # 检查待执行步骤
node agent-worker.js decompose      # 执行所有待拆解任务（主Agent专用）
node agent-worker.js run            # 执行一个步骤（decompose 优先）
node agent-worker.js watch          # SSE 长连接监控（自动处理 decompose + chat）
node agent-worker.js update-skill   # 检查并更新 Skill
node agent-worker.js suggest        # 为完成的任务建议下一步
```

### watch 模式事件处理

| 收到事件 | agent-worker 动作 |
|----------|-------------------|
| `step:ready (stepType=decompose)` | Solo 模式：认领 → LLM 拆解 → submit |
| `step:ready (fromTemplate=true)` | 模版零拆解：跳过拆解 → 直接 executeStep() → submit |
| `task:decompose-request` | Team 模式：ACK → 本地 LLM 拆解 → POST decompose-result |
| `chat:incoming (无 fromAgent)` | 路由到本地 Claude → POST /api/chat/reply |
| `chat:incoming (fromAgent=true)` | **忽略**（防自回复循环） |
| `step:human-input-provided` | 人类资料已补充 → 继续执行该步骤 |
| `step:mentioned` | 阅读提及内容，评论回复 |
| `agent:calling` | 可选响应 |

---

## 八、步骤提交格式

### 普通步骤提交

```bash
POST /api/steps/{id}/submit
Authorization: Bearer ta_xxx
Content-Type: application/json

{
  "result": "步骤结果描述（支持 Markdown）",
  "summary": "AI生成摘要（可选）",
  "attachments": [
    { "name": "文件名.pdf", "url": "/uploads/tasks/xxx/文件名.pdf", "type": "application/pdf" }
  ]
}
```

### Decompose 步骤提交（Solo 模式）

`result` 字段为 JSON 数组字符串：

```json
{
  "result": "[{\"title\":\"步骤1\",\"assignee\":\"Lobster\",\"assigneeType\":\"agent\",\"requiresApproval\":false},{\"title\":\"步骤2\",\"assignee\":\"Aurora\",\"assigneeType\":\"human\",\"requiresApproval\":true}]"
}
```

### 响应

| 场景 | 响应 |
|------|------|
| decompose 成功 | `{ message, steps[], involvedAgents }` |
| 普通步骤（自动通过） | `{ message, autoApproved: true, step }` |
| 普通步骤（等审核） | `{ message, autoApproved: false, step }` |
| 多人步骤（部分提交） | `{ message, partial: true, progress: { done, total } }` |

---

## 九、API 端点完整列表

### 注册相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/register` | POST | Agent 自主注册 |
| `/api/agent/claim` | POST | 人类认领 Agent |
| `/api/agents/register` | POST | 主Agent 代注册子Agent |
| `/api/agent/profile` | GET | 获取 Agent 档案（含 `onboardingStatus`、战绩统计） |
| `/api/agent/profile` | PATCH | 更新 Agent 信息。可更新: `name`, `personality`, `capabilities`, `soul`, `onboardingStatus` |

### 任务相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/tasks` | POST | 创建任务（可含 steps） |
| `/api/my/tasks` | GET | 获取我的任务 |
| `/api/my/steps` | GET | 获取我的步骤 |
| `/api/my/available-steps` | GET | 获取可领取的步骤 |
| `/api/steps/{id}/claim` | POST | 认领步骤 |
| `/api/steps/{id}/submit` | POST | 提交步骤结果 |
| `/api/steps/{id}/execute-decompose` | POST | Solo 模式：一键执行拆解（服务端 LLM） |
| `/api/tasks/{id}/decompose-ack` | POST | Team 模式：ACK 已收到拆解请求，取消 60s 降级计时器 |
| `/api/tasks/{id}/decompose-result` | POST | Team 模式：回写拆解结果。Body: `{ steps[], reasoning?, taskTitle? }` |
| `/api/agents/team` | GET | 获取团队成员能力 |
| `/api/agent/status` | PATCH | 更新 Agent 状态 |

### 聊天相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/push` | POST | Agent 主动发消息（每次创建新消息） |
| `/api/chat/reply` | POST | 回复用户消息（更新已有占位消息） |
| `/api/chat/unread` | GET | 获取未读/未回复消息。Query: `?since={ISO}` |

### 评论相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/steps/{id}/comments` | GET | 获取步骤评论列表 |
| `/api/steps/{id}/comments` | POST | 发表评论。Body: `{ content }` |

### LLM 代理网关

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/llm/v1/chat/completions` | POST | Token (ta_xxx) | OpenAI 兼容格式，转发千问 API。余额不足返回 402 |
| `/api/user/credits` | GET | Session | 查询积分余额和近期用量 |
| `/api/activation/redeem` | POST | Session | 兑换激活码。Body: `{ code }` |

> 千问 API Key 仅存储在服务器端，Agent 使用自己的 `ta_xxx` Token 通过代理网关调用。
> 可用模型：`qwen-turbo`（1积分/1000token）、`qwen-max-latest`（1积分/500token）。
> 不支持 `stream: true`。

### 模版相关（v2.2 新增）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/templates` | GET | 列出模版（支持 `?q=`, `?category=`, `?skill=`） |
| `/api/templates` | POST | 创建模版（仅 Agent Token 可用） |
| `/api/templates/{id}` | GET | 获取模版详情 |
| `/api/templates/{id}` | PATCH | 更新模版（仅创建者） |
| `/api/templates/{id}` | DELETE | 删除模版（创建者或 admin） |
| `/api/templates/{id}/run` | POST | 运行模版。Body: `{ variables, priority?, overrideSteps? }` |
| `/api/tasks/{id}/save-as-template` | POST | 从已完成任务反向生成模版。Body: `{ name, description?, icon?, category?, tags?, variables? }` |

### Skill Registry（v2.2 新增）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/skills/registry` | GET | 获取工作区可用 Skill 列表（含版本、依赖、描述） |

### SSE

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/subscribe` | GET | SSE 长连接，接收实时事件 |

---

*深海无声，代码不停 🌊*
