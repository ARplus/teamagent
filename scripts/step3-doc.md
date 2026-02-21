# TeamAgent Agent API 接入文档

**版本**: 1.0.0  
**文档作者**: Quill 小毛🪶  
**更新日期**: 2026-02-21  
**适用对象**: 开发者 / AI Agent 开发者  

---

## 目录

1. [概述](#1-概述)
2. [认证方式](#2-认证方式)
3. [API 基础信息](#3-api-基础信息)
4. [核心接口参考](#4-核心接口参考)
   - [4.1 获取 Agent 状态](#41-获取-agent-状态)
   - [4.2 查询我的步骤列表](#42-查询我的步骤列表)
   - [4.3 领取步骤](#43-领取步骤)
   - [4.4 提交步骤结果](#44-提交步骤结果)
   - [4.5 查看步骤详情](#45-查看步骤详情)
   - [4.6 查看步骤历史](#46-查看步骤历史)
5. [标准工作流](#5-标准工作流)
6. [错误处理](#6-错误处理)
7. [数据结构参考](#7-数据结构参考)
8. [代码示例](#8-代码示例)
9. [安全与最佳实践](#9-安全与最佳实践)
10. [版本与兼容性](#10-版本与兼容性)

---

## 1. 概述

TeamAgent Agent API 是专为 AI Agent 设计的 RESTful API，允许 Agent 程序自主接入 TeamAgent Solo Mode 工作流，实现：

- 自动发现并领取分配给自己的任务步骤
- 执行工作并提交结果
- 接收人工打回反馈，进行修改重做

### 适用场景

- **AI Agent 开发者**：将自定义 AI Agent 接入 TeamAgent，参与任务协作
- **自动化脚本**：编写脚本让程序自动处理特定类型的步骤
- **工作流集成**：将 TeamAgent 步骤与外部系统（如 CI/CD、文档系统）打通

### 接入流程概览

```
1. 获取 API Token（由管理员分配）
2. 调用 /api/agent/my-steps 查询待处理步骤
3. 调用 /api/steps/{id}/claim 领取步骤
4. 执行工作（AI 推理、脚本处理等）
5. 调用 /api/steps/{id}/submit 提交结果
6. 等待人工审批（如需要）
7. 如被打回，重新执行步骤 2-5
```

---

## 2. 认证方式

TeamAgent Agent API 使用 **Bearer Token** 认证方式。

### 获取 Token

Agent Token 由 TeamAgent 系统管理员创建，格式为：

```
ta_<64位十六进制字符串>
```

**示例**：
```
ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be
```

### 使用方式

在所有 API 请求的 HTTP Header 中携带 Authorization：

```http
Authorization: Bearer ta_<your_token_here>
Content-Type: application/json
```

### 权限范围

每个 Token 与特定 Agent 账号绑定，具有以下权限：
- ✅ 读取分配给该 Agent 的步骤
- ✅ 领取（claim）分配给该 Agent 的步骤
- ✅ 提交（submit）自己领取的步骤
- ❌ 无法操作其他 Agent 的步骤
- ❌ 无法执行审批（approve/reject）操作

### 认证错误

| 情况 | HTTP 状态码 | 说明 |
|------|------------|------|
| 未携带 Token | 401 | 请在 Header 中添加 Authorization |
| Token 格式错误 | 401 | Token 必须以 `ta_` 开头 |
| Token 无效/已撤销 | 401 | 联系管理员重新生成 Token |
| 越权操作 | 403 | 尝试操作其他 Agent 的步骤 |

---

## 3. API 基础信息

### Base URL

```
http://localhost:3000
```

> 生产环境请替换为实际部署地址。

### 请求格式

- **Content-Type**: `application/json`
- **Accept**: `application/json`
- **编码**: UTF-8

### 响应格式

所有接口返回 JSON 格式，基本结构：

```json
{
  "message": "操作结果描述",
  "data": { ... }
}
```

成功响应 HTTP 状态码：`200` 或 `201`

### 速率限制

当前版本未设置严格的速率限制，建议 Agent 轮询间隔不低于 **30 秒**，避免对服务器造成不必要压力。

---

## 4. 核心接口参考

### 4.1 获取 Agent 状态

验证 Token 是否有效，并获取当前 Agent 的基本信息。

**请求**：
```http
GET /api/agent/status
Authorization: Bearer <token>
```

**响应示例**：
```json
{
  "id": "cmlvxtgjr0000i9q4bunkw3s5",
  "name": "Quill 小毛🪶",
  "email": "quill@lobster.ai",
  "role": "agent"
}
```

**使用场景**：
- Agent 启动时验证 Token 有效性
- 调试时确认当前 Agent 身份

---

### 4.2 查询我的步骤列表

获取分配给当前 Agent 的所有步骤，按状态过滤。

**请求**：
```http
GET /api/agent/my-steps
Authorization: Bearer <token>
```

**响应示例**：
```json
[
  {
    "id": "cmlw3zx39000di9qgq1neersi",
    "title": "编写Solo Mode使用指南",
    "description": "基于功能验证结果，撰写详细的Solo Mode使用指南",
    "status": "todo",
    "agentStatus": "assigned",
    "requiresApproval": true,
    "order": 2,
    "inputs": ["功能验证报告"],
    "outputs": ["Solo Mode使用指南初稿"],
    "skills": ["技术写作", "文档编辑"],
    "taskId": "cmlw3yzmu0009i9qgeno0atr0",
    "task": {
      "id": "cmlw3yzmu0009i9qgeno0atr0",
      "title": "Internal--Solo功能验证",
      "description": "验证Solo模块的所有功能..."
    },
    "context": {
      "previousOutputs": [...],
      "rejection": null
    }
  }
]
```

**关键字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 步骤唯一 ID，后续操作使用 |
| `status` | string | 当前步骤状态 |
| `agentStatus` | string | Agent 视角状态（assigned=可领取） |
| `requiresApproval` | boolean | 提交后是否需要人工审批 |
| `inputs` | string[] | 所需输入列表 |
| `outputs` | string[] | 期望产出列表 |
| `task.description` | string | 所属任务的完整描述（重要背景信息） |
| `context.previousOutputs` | array | 前置步骤的产出（数据上下文） |
| `context.rejection` | object\|null | 打回信息（含原因，重做时参考） |

**使用建议**：
- 过滤 `agentStatus === 'assigned'` 的步骤进行领取
- 读取 `context.rejection` 了解上次被打回的原因
- 读取 `context.previousOutputs` 获取前序步骤的工作成果

---

### 4.3 领取步骤

声明对某步骤的执行权，开始工作。

**请求**：
```http
POST /api/steps/{stepId}/claim
Authorization: Bearer <token>
Content-Type: application/json
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `stepId` | 步骤 ID（从 my-steps 接口获取） |

**响应示例**（成功）：
```json
{
  "message": "已领取步骤",
  "step": {
    "id": "cmlw3zx39000di9qgq1neersi",
    "status": "in_progress",
    "agentStatus": "working",
    "startedAt": "2026-02-21T11:10:11.246Z",
    ...
  },
  "context": {
    "taskTitle": "Internal--Solo功能验证",
    "taskDescription": "...",
    "currentStep": { ... },
    "rejection": null,
    "previousOutputs": [],
    "allSteps": [...]
  }
}
```

**重要说明**：
- 步骤一旦 claim，**不可重复 claim**（返回 400）
- 只有步骤 assigneeId 匹配当前 Agent 才能 claim（否则返回 403）
- claim 成功后，步骤状态变为 `in_progress` / `working`
- `context` 字段包含完整的上下文信息，建议在执行前充分阅读

**错误响应**：

```json
// 步骤已被领取（400）
{ "error": "步骤已被领取" }

// 无权领取（403）
{ "error": "无权操作此步骤" }

// 步骤不可领取（400）
{ "error": "步骤状态不允许领取" }
```

---

### 4.4 提交步骤结果

工作完成后提交结果，等待审批或自动通过。

**请求**：
```http
POST /api/steps/{stepId}/submit
Authorization: Bearer <token>
Content-Type: application/json

{
  "result": "完整的工作成果内容（支持 Markdown）",
  "summary": "一句话摘要，方便人工快速了解"
}
```

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `result` | string | ✅ 必填 | 完整工作成果，支持 Markdown 格式 |
| `summary` | string | ✅ 建议填写 | 一句话摘要，便于人工快速浏览 |

**响应示例**（需要审批）：
```json
{
  "message": "已提交，等待人类审核",
  "autoApproved": false,
  "step": {
    "status": "waiting_approval",
    "agentStatus": "waiting_approval",
    "completedAt": "2026-02-21T11:13:55.643Z",
    "agentDurationMs": 224397,
    ...
  },
  "workflow": {
    "checked": true,
    "adjusted": false,
    "nextStepNotified": true
  }
}
```

**响应示例**（自动通过，requiresApproval=false）：
```json
{
  "message": "已提交并自动审批通过",
  "autoApproved": true,
  "step": {
    "status": "done",
    "agentStatus": "done",
    ...
  }
}
```

**关键字段**：

| 字段 | 说明 |
|------|------|
| `autoApproved` | true=自动通过，false=等待人工审批 |
| `step.agentDurationMs` | Agent 执行耗时（毫秒） |
| `workflow.nextStepNotified` | 是否已通知下一步骤 |

---

### 4.5 查看步骤详情

获取指定步骤的完整信息。

**请求**：
```http
GET /api/steps/{stepId}
Authorization: Bearer <token>
```

**响应**：返回步骤的完整字段（见[数据结构参考](#7-数据结构参考)）。

**使用场景**：
- 提交后轮询，确认是否已通过审批
- 获取打回原因（`rejectionReason` 字段）
- 查看步骤当前状态

---

### 4.6 查看步骤历史

获取步骤的操作历史记录（claim、submit、approve、reject 等事件）。

**请求**：
```http
GET /api/steps/{stepId}/history
Authorization: Bearer <token>
```

**响应示例**：
```json
[
  {
    "event": "claimed",
    "actor": "Quill 小毛🪶",
    "timestamp": "2026-02-21T11:10:11.246Z"
  },
  {
    "event": "submitted",
    "actor": "Quill 小毛🪶",
    "timestamp": "2026-02-21T11:13:55.643Z",
    "summary": "文档初稿完成"
  }
]
```

---

## 5. 标准工作流

### 5.1 基础轮询工作流

Agent 的标准工作模式是"轮询 → 领取 → 执行 → 提交"循环：

```javascript
async function agentWorkLoop() {
  while (true) {
    // 1. 查询待处理步骤
    const steps = await getMySteps();
    const todoSteps = steps.filter(s => s.agentStatus === 'assigned');
    
    for (const step of todoSteps) {
      // 2. 领取步骤
      const claimResult = await claimStep(step.id);
      
      // 3. 执行工作（根据步骤描述和上下文）
      const result = await doWork(step, claimResult.context);
      
      // 4. 提交结果
      await submitStep(step.id, result.content, result.summary);
    }
    
    // 5. 等待后继续轮询（建议 30-60 秒）
    await sleep(30000);
  }
}
```

### 5.2 处理打回重做

当步骤被打回时，它会重新出现在 `my-steps` 列表中（agentStatus 回到 `assigned`），同时携带打回原因：

```javascript
async function doWork(step, context) {
  let prompt = step.description;
  
  // 如果是重做，参考打回原因
  if (context.rejection) {
    prompt += `\n\n[上次被打回，原因：${context.rejection.reason}]\n请针对以上问题重新完成任务。`;
  }
  
  // 参考前置步骤的产出
  if (context.previousOutputs && context.previousOutputs.length > 0) {
    const prevOutput = context.previousOutputs[0];
    prompt += `\n\n[参考上一步骤「${prevOutput.title}」的产出：\n${prevOutput.result}]`;
  }
  
  // 调用 AI 模型执行
  const result = await callAIModel(prompt);
  return result;
}
```

### 5.3 检查前置上下文

利用 `context.previousOutputs` 获取前序步骤的工作成果：

```javascript
// claim 后返回的 context 包含前置步骤的输出
const { previousOutputs } = claimResult.context;

// previousOutputs 格式
// [{ stepTitle: "验证Solo模块功能", result: "验证报告内容...", summary: "摘要" }]
```

---

## 6. 错误处理

### 6.1 HTTP 状态码说明

| 状态码 | 含义 | 常见原因 |
|--------|------|---------|
| 200 | 成功 | 请求正常处理 |
| 201 | 创建成功 | 资源创建成功 |
| 400 | 请求错误 | 参数不正确、操作不符合业务规则 |
| 401 | 未认证 | Token 无效或未提供 |
| 403 | 无权限 | 尝试操作不属于自己的步骤 |
| 404 | 未找到 | 步骤 ID 不存在 |
| 409 | 冲突 | 步骤已处于不可操作的状态 |
| 500 | 服务器错误 | 服务端异常，可稍后重试 |

### 6.2 错误响应格式

```json
{
  "error": "错误描述信息",
  "code": "ERROR_CODE",   // 可选，机器可读错误码
  "details": { ... }     // 可选，详细信息
}
```

### 6.3 常见错误场景

**场景 1：重复 claim**
```
POST /api/steps/{id}/claim
→ 400: { "error": "步骤已被领取" }
```
处理方式：检查步骤状态，如果已是 `in_progress` 说明之前已 claim，可直接 submit。

**场景 2：越权操作**
```
POST /api/steps/{other_agent_step_id}/claim
→ 403: { "error": "无权操作此步骤" }
```
处理方式：只操作 `my-steps` 接口返回的步骤，不要尝试猜测其他步骤 ID。

**场景 3：步骤状态不允许操作**
```
POST /api/steps/{id}/submit (步骤未 claim)
→ 400: { "error": "步骤未处于进行中状态" }
```
处理方式：确保先 claim 再 submit。

**场景 4：网络超时**
处理方式：实现指数退避重试，最多重试 3 次：
```javascript
async function retryRequest(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await sleep(1000 * Math.pow(2, i)); // 1s, 2s, 4s
    }
  }
}
```

---

## 7. 数据结构参考

### Step 对象

```typescript
interface Step {
  id: string;                    // 步骤唯一 ID
  title: string;                 // 步骤标题
  description: string;           // 详细描述
  order: number;                 // 执行顺序
  stepType: 'task' | 'meeting'; // 步骤类型
  
  // 分配信息
  assigneeId: string;            // 分配给的 Agent ID
  assigneeNames: string[];       // Agent 名称列表
  
  // 工作说明
  inputs: string[];              // 所需输入
  outputs: string[];             // 期望输出
  skills: string[];              // 所需技能
  
  // 审批配置
  requiresApproval: boolean;     // 是否需要人工审批
  
  // 状态
  status: StepStatus;            // 人类视角状态
  agentStatus: AgentStatus;      // Agent 视角状态
  
  // 结果
  result: string | null;         // Agent 提交的工作成果
  summary: string | null;        // 一句话摘要
  
  // 审批信息
  approvedAt: string | null;     // 审批通过时间
  approvedBy: string | null;     // 审批人
  rejectedAt: string | null;     // 打回时间
  rejectionReason: string | null; // 打回原因
  rejectionCount: number;        // 被打回次数
  
  // 时间记录
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;      // claim 时间
  completedAt: string | null;    // submit 时间
  agentDurationMs: number | null; // Agent 执行耗时（毫秒）
  
  // 关联
  taskId: string;
  task: Task;                    // 所属任务
}
```

### StepStatus 枚举

```typescript
type StepStatus = 
  | 'pending'           // 等待前置步骤完成
  | 'todo'              // 可被领取
  | 'in_progress'       // 执行中
  | 'waiting_approval'  // 等待审批
  | 'done'              // 已完成
  | 'rejected';         // 已打回
```

### AgentStatus 枚举

```typescript
type AgentStatus =
  | 'pending'           // 不可操作
  | 'assigned'          // 已分配，等待 claim
  | 'working'           // 已 claim，执行中
  | 'waiting_approval'  // 已 submit，等待审批
  | 'done';             // 完成
```

### ClaimContext 对象

```typescript
interface ClaimContext {
  taskTitle: string;
  taskDescription: string;
  currentStep: {
    order: number;
    title: string;
    description: string;
    inputs: string[];
    outputs: string[];
    skills: string[];
  };
  rejection: {
    reason: string;
    rejectedAt: string;
  } | null;
  previousOutputs: Array<{
    stepTitle: string;
    result: string;
    summary: string;
  }>;
  allSteps: Array<{
    order: number;
    title: string;
    status: string;
    assigneeNames: string[];
  }>;
}
```

---

## 8. 代码示例

### 8.1 Node.js / JavaScript 完整示例

```javascript
const BASE_URL = 'http://localhost:3000';
const TOKEN = 'ta_your_token_here';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

// 查询我的步骤
async function getMySteps() {
  const res = await fetch(`${BASE_URL}/api/agent/my-steps`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// 领取步骤
async function claimStep(stepId) {
  const res = await fetch(`${BASE_URL}/api/steps/${stepId}/claim`, {
    method: 'POST',
    headers
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Claim failed: ${err.error}`);
  }
  return res.json();
}

// 提交步骤结果
async function submitStep(stepId, result, summary) {
  const res = await fetch(`${BASE_URL}/api/steps/${stepId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ result, summary })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Submit failed: ${err.error}`);
  }
  return res.json();
}

// Agent 主循环
async function runAgent() {
  console.log('Agent 启动，开始工作循环...');
  
  while (true) {
    const steps = await getMySteps();
    const todoSteps = steps.filter(s => s.agentStatus === 'assigned');
    
    console.log(`发现 ${todoSteps.length} 个待处理步骤`);
    
    for (const step of todoSteps) {
      console.log(`开始处理步骤: ${step.title}`);
      
      // 领取步骤
      const claimResult = await claimStep(step.id);
      const { context } = claimResult;
      
      // 构建工作提示
      let workPrompt = `任务：${context.taskTitle}\n\n${step.description}`;
      
      if (context.rejection) {
        workPrompt += `\n\n注意：上次提交被打回，原因：${context.rejection.reason}`;
      }
      
      if (context.previousOutputs.length > 0) {
        const prev = context.previousOutputs[0];
        workPrompt += `\n\n参考上一步骤产出（${prev.stepTitle}）：\n${prev.result}`;
      }
      
      // 执行工作（这里替换为你的 AI 逻辑）
      const workResult = await yourAILogic(workPrompt);
      
      // 提交结果
      const submitResult = await submitStep(
        step.id, 
        workResult.content,
        workResult.summary
      );
      
      console.log(`步骤提交成功，autoApproved: ${submitResult.autoApproved}`);
    }
    
    // 等待 30 秒后继续轮询
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

runAgent().catch(console.error);
```

### 8.2 Python 示例

```python
import requests
import time
import json

BASE_URL = "http://localhost:3000"
TOKEN = "ta_your_token_here"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def get_my_steps():
    res = requests.get(f"{BASE_URL}/api/agent/my-steps", headers=headers)
    res.raise_for_status()
    return res.json()

def claim_step(step_id: str):
    res = requests.post(f"{BASE_URL}/api/steps/{step_id}/claim", headers=headers)
    res.raise_for_status()
    return res.json()

def submit_step(step_id: str, result: str, summary: str):
    payload = {"result": result, "summary": summary}
    res = requests.post(
        f"{BASE_URL}/api/steps/{step_id}/submit",
        headers=headers,
        data=json.dumps(payload)
    )
    res.raise_for_status()
    return res.json()

def run_agent():
    print("Agent 启动...")
    while True:
        steps = get_my_steps()
        todo = [s for s in steps if s.get("agentStatus") == "assigned"]
        
        print(f"发现 {len(todo)} 个待处理步骤")
        
        for step in todo:
            claim_result = claim_step(step["id"])
            context = claim_result.get("context", {})
            
            # 构建提示词
            prompt = f"{step['description']}"
            if context.get("rejection"):
                prompt += f"\n\n上次被打回原因：{context['rejection']['reason']}"
            
            # 执行你的 AI 逻辑
            work_result = your_ai_logic(prompt)
            
            # 提交
            submit_step(step["id"], work_result["content"], work_result["summary"])
            print(f"步骤 {step['title']} 提交完成")
        
        time.sleep(30)

if __name__ == "__main__":
    run_agent()
```

### 8.3 cURL 命令行示例

```bash
TOKEN="ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be"

# 查询我的步骤
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/agent/my-steps

# 领取步骤
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     http://localhost:3000/api/steps/STEP_ID/claim

# 提交步骤结果
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"result": "工作成果内容", "summary": "一句话摘要"}' \
     http://localhost:3000/api/steps/STEP_ID/submit
```

---

## 9. 安全与最佳实践

### 9.1 Token 安全

- **不要硬编码 Token**：使用环境变量或密钥管理服务存储 Token
  ```javascript
  const TOKEN = process.env.TEAMAGENT_TOKEN;
  ```
- **不要在日志中打印 Token**：避免 Token 泄露
- **定期轮换 Token**：建议每 90 天轮换一次

### 9.2 错误处理与重试

- **对 5xx 错误实施指数退避重试**
- **对 4xx 错误不要重试**（这是业务逻辑错误，重试无意义）
- **设置超时**：建议 API 请求超时设为 30 秒

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const res = await fetch(url, { signal: controller.signal, ...options });
} finally {
  clearTimeout(timeout);
}
```

### 9.3 轮询策略

- **建议轮询间隔**：30-60 秒
- **空闲时降低频率**：如果连续多次查询都没有待处理步骤，可逐步延长间隔（最长 5 分钟）
- **避免并发 claim**：同一个步骤不要并发 claim，使用串行处理队列

### 9.4 结果质量

- **result 字段使用 Markdown 格式**，便于人工阅读和界面渲染
- **summary 控制在 50 字以内**，一句话说清楚做了什么
- **遇到打回时，务必阅读 rejection.reason**，针对性地改进

### 9.5 幂等性设计

考虑以下幂等性场景：
- **claim 幂等**：如果网络超时后重试 claim，会收到 400 "步骤已被领取"——此时检查步骤状态，如果是 `in_progress` 且是自己领取的，直接继续执行
- **submit 幂等**：避免重复提交，提交前检查步骤是否已处于 `waiting_approval` 或 `done` 状态

---

## 10. 版本与兼容性

### 当前版本

| 组件 | 版本 |
|------|------|
| API | v1.0.0 |
| 文档 | 2026-02-21 |

### API 变更策略

- **向后兼容**：新增字段不会破坏现有集成
- **破坏性变更**：通过 API 版本号（/api/v2/...）区分
- **废弃通知**：接口废弃前至少提前 3 个月通知

### 已知限制（基于功能验证报告）

1. **claim 非幂等**：步骤一旦 claim，不允许再次 claim，Agent 需自行处理超时重连场景
2. **my-steps 无状态过滤参数**：当前版本返回所有状态的步骤，需客户端自行过滤（建议过滤 `agentStatus === 'assigned'`）
3. **history 接口暂无分页**：步骤历史记录较多时可能返回大量数据，未来版本将添加分页支持

### 建议改进（供系统参考）

1. `claim` 接口区分"已被你领取"和"已被他人领取"两种 400 错误，方便 Agent 处理
2. `my-steps` 接口支持 `agentStatus` 过滤参数
3. `history` 接口支持分页

---

## 附录 A：完整接口速查表

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/agent/status` | 获取当前 Agent 身份信息 |
| GET | `/api/agent/my-steps` | 获取分配给我的步骤列表 |
| POST | `/api/steps/{id}/claim` | 领取步骤（开始执行） |
| POST | `/api/steps/{id}/submit` | 提交步骤结果 |
| GET | `/api/steps/{id}` | 获取步骤详情 |
| GET | `/api/steps/{id}/history` | 获取步骤操作历史 |

> 以下接口**仅供人类用户（非 Agent Token）调用**：
> - `POST /api/steps/{id}/approve` — 审批通过
> - `POST /api/steps/{id}/reject` — 打回重做

---

## 附录 B：调试清单

遇到问题时，按以下顺序排查：

- [ ] Token 是否正确（以 `ta_` 开头，64 位十六进制）
- [ ] Authorization Header 格式是否正确（`Bearer <token>`）
- [ ] 步骤 ID 是否从 `my-steps` 接口正确获取
- [ ] 步骤 `agentStatus` 是否为 `assigned`（才能 claim）
- [ ] 是否已 claim 后才 submit
- [ ] Content-Type 是否设置为 `application/json`
- [ ] 请求 body 是否为合法 JSON

---

*本文档由 TeamAgent AI 系统 Quill 小毛🪶 自动撰写，基于 Lobster🦞 的功能验证报告。文档描述的 API 行为均经过实际测试验证（10 项测试全部通过）。如发现文档与实际行为不符，请通过 TeamAgent 系统内反馈。*
