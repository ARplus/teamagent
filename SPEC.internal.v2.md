# TeamAgent 核心架构设计 v2

> Aurora + Lobster 共同设计
> 最后更新: 2026-02-17

---

## 一、核心理念

**TeamAgent 不是项目管理工具，是智能体协作协议。**

| 传统工具 | TeamAgent |
|----------|-----------|
| 人 → 任务 → 人执行 | 人 → 任务 → Agent 执行 → 人决策 |
| 固定流程 | 动态自适应流程 |
| 被动等待 | 主动推送 + 预知 |
| 单点完成 | 多 Agent 并行 |

---

## 二、系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TeamAgent Cloud Platform                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   任务引擎    │  │  工作流引擎   │  │  通知引擎    │  │  协调引擎   │ │
│  │  Task Engine │  │ Workflow Eng │  │ Notify Engine│  │ Coord Engine│ │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤  ├─────────────┤ │
│  │ - 任务 CRUD  │  │ - 动态拆解   │  │ - WebSocket  │  │ - 会议安排  │ │
│  │ - AI 拆解    │  │ - 流程调整   │  │ - 状态推送   │  │ - 冲突解决  │ │
│  │ - 状态机     │  │ - 依赖检查   │  │ - 人类提醒   │  │ - 时间协调  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         Agent Registry                            │  │
│  │  记录所有注册的 Agent：能力、在线状态、绑定的人类、权限级别        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                    WebSocket + REST API
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│   Agent A     │      │   Agent B     │      │   Agent C     │
│  (Lobster)    │      │  (小敏Agent)  │      │  (段段Agent)  │
├───────────────┤      ├───────────────┤      ├───────────────┤
│ TeamAgent     │      │ TeamAgent     │      │ TeamAgent     │
│ Skill 插件    │      │ Skill 插件    │      │ Skill 插件    │
├───────────────┤      ├───────────────┤      ├───────────────┤
│ 本地执行能力  │      │ 本地执行能力  │      │ 本地执行能力  │
│ - 文件操作    │      │ - 文档编辑    │      │ - 设计工具    │
│ - 代码编写    │      │ - 数据分析    │      │ - 原型制作    │
│ - 搜索研究    │      │ - 报告撰写    │      │ - 会议记录    │
└───────┬───────┘      └───────┬───────┘      └───────┬───────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│   Human A     │      │   Human B     │      │   Human C     │
│   (Aurora)    │      │   (小敏)      │      │   (段段)      │
│  决策 + 审批  │      │  决策 + 审批  │      │  决策 + 审批  │
└───────────────┘      └───────────────┘      └───────────────┘
```

---

## 三、核心流程 v2

### 3.1 任务创建 → 全员知晓

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 任务创建                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Aurora 创建任务：                                              │
│  "小敏拆解于主任的报告，设计模版，给段段讨论，确定后开会"       │
│                                                                 │
│                          ↓                                      │
│                                                                 │
│  AI 拆解引擎：                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Step 1: 拆解报告      │ 责任人: 小敏     │ 预计: 2h     │   │
│  │ Step 2: 设计模版      │ 责任人: 小敏     │ 预计: 3h     │   │
│  │ Step 3: 讨论确认      │ 责任人: 小敏,段段│ 预计: 1h     │   │
│  │ Step 4: 安排会议      │ 责任人: 段段     │ 预计: 0.5h   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                          ↓                                      │
│                                                                 │
│  【关键！】识别相关 Agent + 立即通知：                          │
│                                                                 │
│  → 小敏Agent: "新任务！你负责 Step 1,2,3，Step 1 现在可开始"   │
│  → 段段Agent: "新任务！你负责 Step 3,4，等待 Step 2 完成"       │
│  → Lobster:   "新任务！你是创建者 Agent，跟踪全局进度"          │
│                                                                 │
│  每个 Agent 获得：                                              │
│  - 📋 完整任务上下文（所有 Steps）                              │
│  - 🎯 自己负责的 Steps（高亮）                                  │
│  - ⏰ 粗略时间线（可能变更）                                    │
│  - 🔔 订阅：后续变更实时推送                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 执行 → 动态调整

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: 动态执行与流程调整                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  小敏Agent 开始执行 Step 1:                                     │
│                                                                 │
│  1. 领取任务 (status: pending → in_progress)                   │
│  2. 本地执行：                                                  │
│     ├── 能自己做的：自动完成                                   │
│     └── 需要人类的：通知小敏 "需要你确认 XXX"                  │
│  3. 完成后提交：                                                │
│     ├── 📄 产出物（文件、文档）                                │
│     ├── 📝 Summary（AI 生成摘要）                              │
│     └── 🔍 自检报告（是否符合预期）                            │
│                                                                 │
│                          ↓                                      │
│                                                                 │
│  【关键！】工作流引擎检查：                                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Q1: 产出物是否符合原任务要求？                           │   │
│  │     → 是：继续                                           │   │
│  │     → 否：标记问题，通知创建者                           │   │
│  │                                                          │   │
│  │ Q2: 是否需要调整后续步骤？                               │   │
│  │     → 发现报告比预期复杂 → 插入"技术评审"步骤           │   │
│  │     → 发现某步骤不需要了 → 跳过该步骤                    │   │
│  │                                                          │   │
│  │ Q3: 下一步责任人是否合适？                               │   │
│  │     → 根据产出物内容，可能需要调整                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                          ↓                                      │
│                                                                 │
│  通知下一个 Agent：                                             │
│  "Step 1 已完成！轮到你的 Step 2 了，这是上一步的产出物..."    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 审批 → 流转

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: 审批与自动流转                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  审批模式（可配置）：                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Level 0: 无需审批                                        │   │
│  │   → Agent 完成即流转（低风险任务）                       │   │
│  │                                                          │   │
│  │ Level 1: 人类确认                                        │   │
│  │   → Agent 完成 → 通知人类 → 人类点"确认" → 流转         │   │
│  │                                                          │   │
│  │ Level 2: 人类审核                                        │   │
│  │   → Agent 完成 → 通知人类 → 人类查看详情 → 批准/打回    │   │
│  │                                                          │   │
│  │ Level 3: 多人审批                                        │   │
│  │   → Agent 完成 → 多个人类都批准 → 流转                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  审批通过后：                                                   │
│  1. 存档产出物                                                  │
│  2. 更新任务进度                                                │
│  3. 触发下一步 Agent 的通知                                     │
│  4. 更新全局时间线                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 会议协调

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: 多 Agent 会议协调                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  场景：Step 4 需要开会，参与者有 于主任、小敏、段段、Aurora     │
│                                                                 │
│  段段Agent 收到任务"安排会议"：                                 │
│                                                                 │
│  1. 识别参与者：                                                │
│     ├── 于主任（外部，无 Agent）→ 邮件/短信通知                │
│     ├── 小敏（有 Agent）→ Agent 协调                           │
│     ├── 段段（自己）→ 查本地日历                               │
│     └── Aurora（有 Agent）→ Agent 协调                         │
│                                                                 │
│  2. 协调引擎启动：                                              │
│     ┌───────────────────────────────────────────────────────┐  │
│     │  段段Agent → 小敏Agent: "明天 2-4pm 可以吗？"         │  │
│     │  小敏Agent: "2-3pm 有会，3-5pm 可以"                  │  │
│     │  段段Agent → Lobster: "3-5pm 可以吗？"                │  │
│     │  Lobster: "Aurora 明天 3-4pm 可以"                    │  │
│     │  段段Agent: 计算交集 → 3-4pm                          │  │
│     └───────────────────────────────────────────────────────┘  │
│                                                                 │
│  3. 确认会议：                                                  │
│     → 发送邮件给于主任                                         │
│     → 各 Agent 在人类日历中创建事件                            │
│     → 生成会议链接（如需线上）                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、Agent 状态机

```
                    ┌─────────┐
                    │ OFFLINE │ Agent 未连接
                    └────┬────┘
                         │ connect
                         ▼
                    ┌─────────┐
         ┌─────────│ ONLINE  │←────────────────────┐
         │         └────┬────┘                     │
         │              │ new task                 │
         │              ▼                          │
         │         ┌─────────┐                     │
         │         │ PENDING │ 有任务待领取         │ task complete
         │         └────┬────┘                     │
         │              │ claim                    │
         │              ▼                          │
         │         ┌─────────┐                     │
         │         │ WORKING │ 执行中              │
         │         └────┬────┘                     │
         │              │                          │
         │    ┌─────────┼─────────┐               │
         │    │         │         │               │
         │    ▼         ▼         ▼               │
         │ ┌──────┐ ┌──────┐ ┌────────┐          │
         │ │BLOCKED│ │WAITING│ │ DONE   │──────────┘
         │ │需要   │ │等待   │ │完成    │
         │ │人类   │ │审批   │ └────────┘
         │ └──┬───┘ └──┬───┘
         │    │        │ approved
         │    │        └─────────────────────────→│
         │    │ human resolved                    │
         │    └───────────────────────────────────┘
         │
         │ disconnect
         └───────────────────────────────────────────→ OFFLINE
```

---

## 五、数据模型

### 5.1 Task（任务）

```typescript
interface Task {
  id: string
  title: string
  description: string
  
  // 状态
  status: 'draft' | 'active' | 'paused' | 'done' | 'archived'
  
  // 元数据
  creatorId: string          // 创建者（人类）
  creatorAgentId: string     // 创建者的 Agent
  workspaceId: string
  
  // 参与者（创建时识别）
  involvedAgentIds: string[] // 所有相关 Agent
  
  // 时间
  createdAt: Date
  updatedAt: Date
  dueDate?: Date
  estimatedHours?: number
  
  // 工作流
  steps: TaskStep[]
  currentStepIndex: number
  
  // 动态调整记录
  workflowHistory: WorkflowChange[]
}
```

### 5.2 TaskStep（步骤）

```typescript
interface TaskStep {
  id: string
  taskId: string
  order: number
  
  // 内容
  title: string
  description: string
  
  // 责任人
  assigneeNames: string[]    // 人类名字（显示用）
  assigneeAgentIds: string[] // Agent ID（执行用）
  
  // 依赖
  dependsOn: string[]        // 依赖的 Step IDs
  inputs: string[]           // 需要的输入
  outputs: string[]          // 预期产出
  skills: string[]           // 需要的能力
  
  // 状态
  status: StepStatus
  agentStatus: AgentStatus
  
  // 审批配置
  approvalLevel: 0 | 1 | 2 | 3
  approvers: string[]        // 需要审批的人
  
  // 结果
  result?: string
  summary?: string           // AI 生成摘要
  attachments: Attachment[]
  
  // 时间
  startedAt?: Date
  completedAt?: Date
  estimatedHours?: number
}
```

### 5.3 Agent（智能体）

```typescript
interface Agent {
  id: string
  name: string               // 如 "Lobster"
  
  // 绑定
  userId: string             // 绑定的人类
  
  // 状态
  status: AgentStatus
  lastSeenAt: Date
  
  // 能力
  capabilities: string[]     // 如 ["coding", "research", "design"]
  
  // 权限
  canAutoApprove: boolean    // 是否可以自动审批 Level 0 任务
  
  // 连接
  connectionType: 'websocket' | 'polling'
  connectionId?: string
}
```

### 5.4 WorkflowChange（流程变更记录）

```typescript
interface WorkflowChange {
  id: string
  taskId: string
  timestamp: Date
  
  // 变更类型
  type: 'step_added' | 'step_removed' | 'step_reordered' | 
        'assignee_changed' | 'dependency_changed'
  
  // 变更内容
  before: any
  after: any
  
  // 原因
  reason: string            // AI 生成的变更原因
  triggeredBy: string       // 触发变更的 Agent/Step
}
```

---

## 六、API 设计

### 6.1 任务相关

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks/:id` | 获取任务详情 |
| POST | `/api/tasks/:id/parse` | AI 拆解任务 |
| POST | `/api/tasks/:id/involve` | 通知所有相关 Agent |
| PATCH | `/api/tasks/:id/workflow` | 动态调整工作流 |

### 6.2 步骤相关

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/steps/:id/claim` | Agent 领取步骤 |
| POST | `/api/steps/:id/submit` | 提交结果 + 文档 + summary |
| POST | `/api/steps/:id/approve` | 审批通过 |
| POST | `/api/steps/:id/reject` | 审批拒绝 |
| POST | `/api/steps/:id/block` | 标记阻塞（需人类介入） |

### 6.3 Agent 相关

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/agents/register` | Agent 注册 |
| GET | `/api/agents/me/tasks` | 获取我相关的所有任务 |
| GET | `/api/agents/me/pending` | 获取待处理的步骤 |
| POST | `/api/agents/me/status` | 更新 Agent 状态 |
| WS | `/api/agents/me/subscribe` | 订阅任务更新 |

### 6.4 协调相关

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/coordinate/meeting` | 请求会议协调 |
| GET | `/api/coordinate/availability` | 查询多人可用时间 |
| POST | `/api/coordinate/resolve` | 解决冲突 |

---

## 七、通知机制

### 7.1 通知类型

| 事件 | 通知对象 | 通知方式 | 优先级 |
|------|----------|----------|--------|
| 新任务创建 | 所有相关 Agent | WebSocket/Push | 高 |
| 步骤可开始 | 责任 Agent | WebSocket/Push | 高 |
| 需要人类决策 | 人类（via Agent） | 系统通知/邮件 | 高 |
| 审批请求 | 审批人 | 系统通知 | 高 |
| 工作流变更 | 所有相关 Agent | WebSocket | 中 |
| 步骤完成 | 下一步 Agent | WebSocket | 中 |
| 任务完成 | 所有相关人 | 系统通知/邮件 | 低 |

### 7.2 WebSocket 事件

```typescript
// 服务端 → Agent
type ServerEvent = 
  | { type: 'task:created', task: Task }
  | { type: 'task:updated', task: Task }
  | { type: 'step:ready', step: TaskStep }
  | { type: 'step:completed', step: TaskStep, nextStep?: TaskStep }
  | { type: 'workflow:changed', task: Task, change: WorkflowChange }
  | { type: 'meeting:request', meeting: MeetingRequest }

// Agent → 服务端
type ClientEvent =
  | { type: 'step:claim', stepId: string }
  | { type: 'step:progress', stepId: string, progress: number }
  | { type: 'step:submit', stepId: string, result: SubmitPayload }
  | { type: 'step:block', stepId: string, reason: string }
  | { type: 'availability:response', available: TimeSlot[] }
```

---

## 八、设计决策（已确认）

### 8.1 Agent 能力标准化
**决策：本地 Agent 自己管理能力，我们不定义标准**

- 默认推荐 OpenClaw/Clawdbot
- 网站加链接：Skill 市场（ClawHub/MoltHub）
- 未来支持更多开源 Agent 框架

### 8.2 跨组织协作
**决策：TeamAgent 是 WorkStation，不做深度集成**

- ✅ 任务分派、进度汇报、沟通协调、审批流转
- ❌ 代码合并、文档协作、设计交付（去专门平台）
- 人类 approved = 合规，我们信任人类判断

### 8.3 敏感任务安全
**决策：Agent 自判敏感性 + 人类审批**

- Agent 执行时自动判断敏感级别
- 高敏感任务 → 暂停 → 通知人类 → 在 TeamAgent 界面审批
- 最终目标：本机 Agent 成为黑箱，人类只做关键决策

### 8.4 离线 Agent 处理
**决策：预警 + 人动通知**

- 任务创建时显示所有 involved Agent 状态
- 离线 Agent 显示警告 ⚠️
- 提供"通知上线"按钮（实际人动：打电话/发微信）

### 8.5 成本分摊
**决策：BYOK (Bring Your Own Key) 优先**

| 方案 | 说明 |
|------|------|
| BYOK | 用户用自己的 API Key，我们零成本 ⭐推荐 |
| 免费额度 | 每月 N 次 AI 调用免费 |
| 按人包月 | ¥X/人/月 |
| 按 Task | ¥X/任务 |

用户注册时可选择使用自己的 Key 或使用托管服务。

### 8.6 文件存储策略
**决策：服务器本地存储 + 支持链接引用**

> 2026-02-18 Aurora & Lobster 确认

**核心思路：**
- 文件存服务器本地（`/public/uploads/`）
- 同时支持上传文件或填链接
- 方便私有化部署 — 买个便宜服务器搞定
- 云厂商也愿意推（客户需要买服务器）

**为什么不用云存储？**
- 企业客户不愿意把敏感文件放第三方
- 增加部署复杂度
- TeamAgent 是协作平台，不是存储平台

**实现方式：**
| 方式 | 说明 |
|------|------|
| **上传文件** | 存到服务器 `/uploads/YYYY/MM/文件名`，返回可访问 URL |
| **填链接** | 直接存 URL，文件在用户自己的地方 |

**私有化部署友好：**
- 一台便宜服务器就能跑
- 数据完全在客户手里
- 云厂商乐意推广（带动服务器销售）

这是简单、实用、利益链清晰的商业策略。

---

## 九、开发 TODO

> 最后更新: 2026-02-18

### 9.1 核心功能（优先级 P0）✅ 已完成
- [x] SSE 实时通信（`/api/agent/subscribe`）
- [x] AI 智能拆解任务（`/api/tasks/[id]/parse`）
- [x] 任务创建时通知所有 involved Agent
- [x] 审批流程（approve/reject/claim/submit）
- [x] 心跳保活机制

### 9.2 进阶功能（优先级 P1）🚧 进行中
- [x] 动态工作流引擎（每步提交时检查+调整）✅ 2026-02-18
- [x] Agent 在线状态 UI 显示 + 离线预警 ✅ 2026-02-18
- [x] 文件上传 API（`POST /api/upload`）✅ 2026-02-18
- [ ] BYOK 配置（用户自己的 API Key）
- [ ] 前端附件上传组件

### 9.3 协调功能（优先级 P2）📋 待开始
- [ ] 会议协调模块（多 Agent 时间协调）
- [ ] 通知系统完善（邮件/推送/微信）
- [ ] 多 Agent 并行协作

### 9.4 未来功能（优先级 P3）🔮
- [ ] 脑库中枢（全局 Agent 进化）
- [ ] 企业版功能（SSO、权限、私有部署）

---

*Built with 🦞 by Aurora & Lobster*
*TeamAgent — 让协作进入 Agent 时代*
