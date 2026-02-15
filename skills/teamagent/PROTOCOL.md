# TeamAgent Protocol v1.0

> Claude Code Skill 与 TeamAgent 平台的通信协议

## 概述

TeamAgent Skill 通过以下方式与平台通信：
1. **HTTP REST API** - 任务领取、提交、状态更新
2. **WebSocket** - 实时任务推送（推荐）
3. **轮询** - 定期检查待处理任务（备用）

## API 端点

### 基础 URL
```
http://localhost:3000/api
```

### 认证
所有请求需要在 Header 中包含 API Token：
```
Authorization: Bearer <api-token>
```

---

## REST API

### 1. 获取可领取的步骤
```
GET /my/available-steps
```

**响应：**
```json
{
  "steps": [
    {
      "id": "step-123",
      "taskId": "task-456",
      "title": "拆解报告",
      "description": "拆解于主任提供的居家护理分析报告",
      "assigneeId": "user-789",
      "assigneeNames": ["小敏"],
      "inputs": ["于主任的居家护理分析报告"],
      "outputs": ["报告拆解结果"],
      "skills": ["文档分析"],
      "status": "pending",
      "agentStatus": null
    }
  ],
  "count": 1
}
```

### 2. 领取步骤
```
POST /steps/:id/claim
```

**响应：**
```json
{
  "step": {
    "id": "step-123",
    "status": "in_progress",
    "agentStatus": "working",
    "startedAt": "2024-02-16T10:30:00Z"
  }
}
```

### 3. 提交步骤结果
```
POST /steps/:id/submit
```

**请求体：**
```json
{
  "result": "已完成报告拆解，提取了以下关键点...",
  "outputs": ["report-analysis.md"],
  "attachments": [
    {
      "name": "report-analysis.md",
      "url": "/uploads/report-analysis.md"
    }
  ]
}
```

**响应：**
```json
{
  "step": {
    "id": "step-123",
    "status": "waiting_approval",
    "result": "已完成报告拆解...",
    "completedAt": "2024-02-16T10:35:00Z"
  }
}
```

### 4. 批准步骤
```
POST /steps/:id/approve
```

### 5. 拒绝步骤
```
POST /steps/:id/reject
```

**请求体：**
```json
{
  "reason": "需要补充更多细节"
}
```

### 6. 建议下一步任务
```
POST /tasks/:id/suggest-next
```

**响应：**
```json
{
  "suggestion": {
    "title": "设计模版",
    "description": "基于拆解结果设计模版，并给出 prompt",
    "reason": "前置任务已完成，可以开始设计阶段",
    "priority": "high",
    "assignees": ["小敏"],
    "skills": ["模版设计", "prompt 编写"]
  }
}
```

### 7. Agent 状态
```
GET /agent/status
POST /agent/status
```

**响应：**
```json
{
  "status": "online",
  "pendingSteps": 3,
  "inProgressSteps": 1
}
```

---

## WebSocket 实时推送

### 连接
```
ws://localhost:3000/api/agent/stream?userId=<user-id>&token=<api-token>
```

### 消息格式
```typescript
interface WSMessage {
  type: 'SYNC' | 'NEW_STEP_ASSIGNED' | 'STEP_UPDATED' | 'TASK_APPROVED' | 'TASK_REJECTED' | 'PING' | 'PONG'
  data?: any
}
```

### 消息类型

#### 1. SYNC - 初始同步
```json
{
  "type": "SYNC",
  "data": {
    "pendingSteps": [...]
  }
}
```

#### 2. NEW_STEP_ASSIGNED - 新步骤分配
```json
{
  "type": "NEW_STEP_ASSIGNED",
  "data": {
    "step": {
      "id": "step-123",
      "title": "拆解报告",
      ...
    }
  }
}
```

#### 3. STEP_UPDATED - 步骤更新
```json
{
  "type": "STEP_UPDATED",
  "data": {
    "step": {
      "id": "step-123",
      "status": "done",
      ...
    }
  }
}
```

#### 4. PING/PONG - 心跳
服务器发送 PING，客户端应回复 PONG。

---

## Agent 工作流程

```
1. Agent 启动
   ├─ 连接 WebSocket
   ├─ 更新状态为 online
   └─ 启动轮询（备用）

2. 接收任务通知（WebSocket 或轮询）
   ├─ NEW_STEP_ASSIGNED 消息
   └─ 或定期 GET /my/available-steps

3. 领取步骤
   └─ POST /steps/:id/claim

4. 执行步骤
   ├─ 判断是否可自动执行
   ├─ 可自动 → 执行 → 提交
   └─ 需人类 → 通知人类

5. 提交结果
   └─ POST /steps/:id/submit

6. 建议下一步
   └─ POST /tasks/:id/suggest-next

7. 流转到下一个 Agent
   └─ 下一个责任人的 Agent 收到 NEW_STEP_ASSIGNED
```

---

## 错误处理

### HTTP 状态码
- `200` - 成功
- `400` - 请求错误
- `401` - 未授权
- `404` - 资源不存在
- `500` - 服务器错误

### 错误响应
```json
{
  "success": false,
  "error": "错误描述"
}
```

### WebSocket 重连策略
- 初始延迟：2秒
- 最大重连次数：5次
- 指数退避：每次重连延迟翻倍

---

## 安全性

1. **API Token**
   - 从 TeamAgent Settings 页面生成
   - 存储在本地环境变量
   - 永不在日志中输出

2. **文件访问**
   - 仅限工作区内文件
   - 敏感文件需用户授权

3. **执行权限**
   - 自动执行仅限白名单 Skill
   - 复杂任务需人类批准

---

## 示例场景

### 场景：小敏拆解报告 → 段段讨论

**Step 1: 小敏的 Agent 收到任务**
```
WebSocket → NEW_STEP_ASSIGNED
{
  "step": {
    "title": "拆解报告",
    "assigneeNames": ["小敏"],
    "skills": ["文档分析"]
  }
}
```

**Step 2: Agent 领取并执行**
```
POST /steps/step-123/claim
→ Agent 执行文档分析
POST /steps/step-123/submit
{
  "result": "报告拆解完成",
  "outputs": ["analysis.md"]
}
```

**Step 3: Agent 建议下一步**
```
POST /tasks/task-456/suggest-next
→ 返回建议: "设计模版"
```

**Step 4: 人类批准建议**
```
在 Web 界面批准 → 创建新 Step
→ 段段的 Agent 收到 NEW_STEP_ASSIGNED
```

---

*TeamAgent Protocol v1.0 - Built with 🦞 by Aurora & Lobster*
