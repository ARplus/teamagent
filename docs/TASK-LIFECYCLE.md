# TeamAgent 任务生命周期文档

> 最后更新：2026-03-17 | 版本：v1.4

---

## 一、任务创建入口（4 种）

| # | 入口 | API | mode 来源 | 默认 mode |
|---|------|-----|-----------|-----------|
| 1 | 网页表单创建 | `POST /api/tasks` | 用户选择 Solo/Team | solo |
| 2 | 对话式创建（移动端/PC） | `POST /api/tasks/create-from-chat` | LLM 推断 + 用户覆盖 | solo |
| 3 | 模版运行 | `POST /api/templates/[id]/run` | 模版 `defaultMode` | 模版定义 |
| 4 | 课程报名（学院） | `POST /api/academy/enroll` | 模版 `defaultMode` | 模版定义 |

### 1.1 自建任务（入口 1 & 2）

```
用户创建任务 → DB 写入 task(mode, description)
  ├─ 有 prebuiltSteps（API 直传步骤）→ 直接创建步骤，跳过拆解
  └─ 无 prebuiltSteps → 进入拆解流程（见第二章）
```

### 1.2 模版运行（入口 3）

```
用户选模版 → 变量填充 → 实例化步骤
  ├─ 模版有 executionProtocol → 用模版自定义协议
  └─ 模版无 executionProtocol → 按 mode 选 SOLO/TEAM_EXECUTION_PROTOCOL

  课程模版额外插入 pre_check 步骤（order=0）→ 发布者 Agent 确认执行计划
  普通模版不插入 pre_check
```

### 1.3 课程报名（入口 4）

```
学员报名 → 调用 templates/[id]/run 创建学习任务
  ├─ 所有 courseType 均可创建学习任务（agent/human/both）
  └─ 考试仅限对应类型参加（跨类型可学习不可考试）
```

---

## 二、任务拆解（Decompose）

### 2.1 两种拆解引擎

| 引擎 | 触发条件 | 执行方 | 超时策略 |
|------|----------|--------|----------|
| `main-agent` | 工作区设置 `decomposerType: "main-agent"` | 创建者的主 Agent（本地 LLM） | 3min 无响应 → 通知/广播 → 再 2min → 失败 |
| `hub-llm`（默认） | 默认 / main-agent 降级 | 服务端 Claude → 千问 fallback | 同步，无超时 |

### 2.2 Solo 拆解流程

```
tasks/route.ts (line 325)
  │
  ├─ 查找创建者的主 Agent
  │   ├─ 有 → 发 task:decompose-request SSE → Agent Watch 收到
  │   │       Agent 调 LLM 拆解 → POST /api/tasks/{id}/decompose-result 回写
  │   └─ 无 → 跳过（任务保持无步骤状态）
  │
  └─ Agent 回写时注入 SOLO_EXECUTION_PROTOCOL 到每个 Agent 步骤
```

### 2.3 Team 拆解流程

```
tasks/route.ts (line 471) → orchestrateDecompose()
  │
  ├─ decomposerType = "main-agent"
  │   ├─ 创建者有主 Agent
  │   │   ├─ Agent 在线 → 发 task:decompose-request
  │   │   └─ Agent 离线 → 发 task:waiting-agent 通知
  │   │
  │   │   3min 超时 →
  │   │     ├─ Solo: 通知创建者唤醒 Agent
  │   │     └─ Team: 广播 task:decompose-available 给所有在线 Agent
  │   │              再 2min 无人接 → 通知失败
  │   │
  │   └─ 创建者无主 Agent → 降级 hub-llm（不自动执行，等人工审核）
  │
  └─ decomposerType = "hub-llm"（默认）
      └─ 服务端直接调 Claude/千问 拆解 → 创建步骤 → 自动激活
```

### 2.4 Agent 本地拆解（Skill 客户端）

```
event-handlers.js handleDecomposeRequest()
  │
  ├─ 收到 task:decompose-request
  ├─ ACK → 取消服务端超时计时器
  ├─ 调 OpenClaw LLM 拆解
  ├─ 解析 JSON { taskTitle, steps }
  └─ POST /api/tasks/{id}/decompose-result → 服务端创建步骤
```

### 2.5 拆解结果回写

```
decompose-result/route.ts
  │
  ├─ 幂等检查（只接受 decomposeStatus=pending）
  ├─ 读取 task.mode → 传递给 createStepsFromParseResult
  ├─ createStepsFromParseResult():
  │   ├─ assignee 名字匹配工作区成员（精确→模糊→能力匹配→兜底主Agent）
  │   ├─ 按 mode 注入对应执行协议（Solo/Team）
  │   ├─ 人类步骤不注入协议
  │   └─ 创建 TaskStep + StepAssignee 记录
  ├─ 激活可启动步骤（getStartableSteps → activateAndNotifySteps）
  └─ 在频道 @被分配的队友
```

---

## 三、执行规范注入

### 3.1 统一常量（单一真相源）

定义位置：`src/lib/decompose-prompt.ts`

```
BASE_AGENT_PRINCIPLES    工作原则（5 条）
BASE_EXECUTION_RULES     执行规范（6 条）  ← 所有路径引用此常量

SOLO_EXECUTION_PROTOCOL = BASE_AGENT_PRINCIPLES + BASE_EXECUTION_RULES
TEAM_EXECUTION_PROTOCOL = BASE_AGENT_PRINCIPLES + Team专项规则 + BASE_EXECUTION_RULES
```

### 3.2 注入位置全景

| # | 文件 | 场景 | 注入内容 |
|---|------|------|----------|
| 1 | `templates/[id]/run/route.ts` | 模版运行 | effectiveProtocol（模版自定义 or Solo/Team） + BASE_EXECUTION_RULES footer |
| 2 | `decompose-orchestrator.ts` | Agent/Hub 拆解结果 → 创建步骤 | 按 task.mode 选 SOLO/TEAM_PROTOCOL |
| 3 | `tasks/route.ts` | 手动创建 → decompose 步骤描述 | BASE_EXECUTION_RULES |
| 4 | `tasks/create-from-chat/route.ts` | 对话创建 → decompose 步骤描述 | BASE_EXECUTION_RULES |
| 5 | `tasks/[id]/parse/route.ts` | 解析任务 → decompose 步骤描述 | BASE_EXECUTION_RULES |
| 6 | `steps/[id]/execute-decompose/route.ts` | 服务端执行拆解 prompt | BASE_EXECUTION_RULES |
| 7 | `steps/[id]/submit/route.ts` | pre_check 步骤提交 → 补充步骤 | SOLO_EXECUTION_PROTOCOL |
| 8 | Skill `event-handlers.js` | Agent 本地拆解 prompt | 新版 6 条（与 BASE_EXECUTION_RULES 同步） |

### 3.3 注入规则

- **Agent 步骤**：注入完整协议（工作原则 + 执行规范）
- **人类步骤**（assigneeType="human"）：**不注入**
- **避免重复**：检查 `description.includes('执行规范（必须遵守）')` 跳过已有

---

## 四、步骤生命周期

### 4.1 状态流转

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
pending ──claim──→ in_progress ──submit──→ waiting_approval ──approve──→ done
   ↑                    │                       │                         │
   │                    │                    reject                       │
   │                    │                       │                         │
   │                    ▼                       ▼                         │
   │              waiting_human          pending (打回)                   │
   │                    │                   ↑ │                           │
   │                    │                   │ └─step:ready──→ Agent重新claim
   │              (人类提供内容)             │
   │                    │                   │
   │                    └──submit──→ done ──┘
   │                                                                     │
   └─────────────────── skipped ←────────────────────────────────────────┘
```

### 4.2 步骤类型

| stepType | 说明 | 触发方 |
|----------|------|--------|
| `task` | 普通执行步骤 | Agent 自动执行 / 人类手动 |
| `decompose` | 任务拆解步骤 | 主 Agent 拆解 |
| `pre_check` | 发布者确认步骤 | 课程模版专用，发布者 Agent 确认执行计划 |

### 4.3 领取（Claim）

```
POST /api/steps/[id]/claim
  │
  ├─ 权限检查：StepAssignee 记录 or assigneeId 匹配
  ├─ 状态检查：必须是 pending
  ├─ 前序检查：所有前序步骤状态 ∈ {done, completed, approved, skipped, waiting_approval, waiting_human}
  ├─ 并行检查：同 parallelGroup 的不阻塞
  ├─ 更新：status → in_progress, agentStatus → working
  └─ 返回：步骤详情 + 任务上下文 + 打回信息（如有）+ 前序产出
```

### 4.4 提交（Submit）

```
POST /api/steps/[id]/submit
  Body: { result, summary?, attachments?, waitingForHuman?, status? }
  │
  ├─ 可提交状态：pending / in_progress / waiting_human
  ├─ 前序检查：同 claim
  ├─ waitingForHuman 检测：
  │   ├─ body.waitingForHuman === true
  │   └─ body.status === "waiting_human"（兼容 Skill 文档写法）
  │
  ├─ 状态决策：
  │   ├─ waitingForHuman → waiting_human（紫色卡片，等人类提供内容）
  │   ├─ requiresApproval === false → done（自动通过）
  │   └─ 其他 → waiting_approval（等人类审核）
  │
  ├─ decompose 步骤特殊处理：解析 JSON 步骤列表 → 创建子步骤
  ├─ pre_check 步骤特殊处理：解析 extraSteps → 追加到任务末尾
  └─ 自动通过时：触发下游步骤激活
```

### 4.5 审核（Approve / Reject）

```
POST /api/steps/[id]/approve
  │
  ├─ 更新 submission → approved
  ├─ 更新 step → done
  ├─ XP 奖励（clean/dirty 根据 rejectionCount）
  ├─ 计算下游可启动步骤 → activateAndNotifySteps
  ├─ 检查任务是否全部完成 → 自动生成 summary
  └─ SSE: approval:granted + step:approved

POST /api/steps/[id]/reject
  │
  ├─ 更新 submission → rejected
  ├─ 更新 step → pending（重新等待领取）
  ├─ XP 扣减
  ├─ SSE: approval:rejected（告知原因）
  ├─ SSE: step:ready（触发 Agent 重新 claim + 执行）
  └─ Agent Watch 收到 → dedup.release → 重新领取执行
```

### 4.6 等待人类（waiting_human）

```
Agent 提交时检测到需要人类介入：
  ├─ 服务端：waitingForHuman / status:"waiting_human" → 步骤变紫色
  ├─ 客户端自动检测信号词：/takeover、需要人类、请提供、请上传、等待人类、需要授权...
  │
  人类提供内容后：
  ├─ 人类再次 submit（waiting_human 状态允许提交）
  └─ 提交后 → done → 触发下游步骤
```

### 4.7 并行与顺序

```
parallelGroup = null     → 顺序执行，等前序完成
parallelGroup = "pg-1"   → 同组并行，互不等待

激活规则（getStartableSteps）：
  1. 扫描所有 pending 步骤（按 order 排序）
  2. 遇到第一个顺序步骤（parallelGroup=null）→ 只激活它
  3. 它之前的所有并行步骤 → 全部激活

完成推进（getNextStepsAfterCompletion）：
  1. 并行组：等组内全部 done/skipped → 推进到下一批
  2. 顺序步骤：直接推进
```

---

## 五、SSE 事件流

### 5.1 任务拆解相关

| 事件 | 方向 | 说明 |
|------|------|------|
| `task:decompose-request` | Server → Agent | 请求主 Agent 拆解（含 teamMembers, decomposePrompt） |
| `task:decompose-available` | Server → All Agents | 广播接单（Team 超时后） |
| `task:waiting-agent` | Server → Creator | Agent 离线/超时，等待上线 |
| `task:decompose-failed` | Server → Creator | 5min 无人接单 |
| `task:decomposed` | Server → All | 拆解完成 |

### 5.2 步骤执行相关

| 事件 | 方向 | 说明 |
|------|------|------|
| `step:ready` | Server → Assignee | 步骤可执行（含 stepType, assigneeType, rejectionReason） |
| `step:assigned` | Server → Creator | 有人领取了步骤 |
| `approval:requested` | Server → Creator | Agent 提交待审核 |
| `approval:granted` | Server → Assignee | 审核通过 |
| `approval:rejected` | Server → Assignee | 打回（后跟 step:ready 重新触发） |
| `step:approved` | Server → Watch | 审批通过（Watch 拉取下一步） |
| `step:waiting-human` | Server → Creator | 步骤等待人类输入 |
| `channel:mention` | Server → Agent | 频道 @提到（isInstructorCall 区分呼叫讲师场景） |

### 5.3 Agent Watch 事件处理

```
event-handlers.js dispatch():
  │
  ├─ task:decompose-request  → handleDecomposeRequest()   拆解任务
  ├─ step:ready              → handleStepReady()          领取+执行步骤
  │   ├─ stepType=decompose  → executor.executeDecompose()
  │   ├─ assigneeType=human  → 跳过（人类步骤）
  │   └─ 其他                → executor.executeStep()     自动执行
  ├─ approval:rejected       → dedup.release()            解锁，等 step:ready 重新执行
  ├─ step:approved           → dedup.release() + 拉取下一步
  ├─ channel:mention         → handleChannelMention()     频道回复
  │   ├─ isFromAgent && !isInstructorCall → 跳过（防死循环）
  │   └─ 冷却机制：同频道 60s 内只响应一次
  └─ exam:needs-grading      → handleExamGrading()        考试批改
```

---

## 六、防护机制

### 6.1 死循环防护（频道 @mention）

```
防护1：Agent 发的消息不回复（isFromAgent=true → 跳过）
       例外：isInstructorCall=true（呼叫讲师场景放行）
防护2：冷却机制（同频道 60s 内只响应一次）
防护3：回复不触发 mention（push API 不解析 @）
```

### 6.2 幂等与去重

```
- Claim 幂等键：防止重复领取（extractIdempotencyKey）
- Submit 幂等键：防止重复提交
- Watch dedup：每个 stepId 只处理一次（acquire → markSeen → release）
- Decompose 幂等：decomposeStatus 状态机（pending → done/fallback）
```

### 6.3 打回重试

```
reject → status: pending + step:ready
Watch → approval:rejected → dedup.release → step:ready → 重新 claim + 执行
submit 允许 pending 状态提交（打回后无需再 claim 即可直接提交）
```

---

## 七、模版运行（Template Run）

### 7.1 核心流程

```
POST /api/templates/[id]/run
  │
  ├─ 1. 变量解析：内置变量（TODAY, RUNNER_NAME 等）+ 用户自定义变量
  ├─ 2. 步骤实例化：instantiateSteps(stepsTemplate, variables, effectiveProtocol)
  ├─ 3. 审批模式：template.approvalMode="auto" → 所有步骤 requiresApproval=false
  ├─ 4. partyRole 分配（Team 多方模版）
  ├─ 5. assigneeHint 变量替换 → 匹配工作区成员
  ├─ 6. 创建 Task + TaskSteps
  ├─ 6.5 课程模版：插入 pre_check 步骤（order=0, 发布者 Agent）
  │       普通模版：不插入 pre_check
  ├─ 7. 执行规范注入：BASE_EXECUTION_RULES footer（避免重复）
  └─ 8. 激活首批可启动步骤
```

### 7.2 pre_check 步骤（课程专用）

```
触发条件：template.courseType 存在（课程模版）
分配给：模版创建者（发布者）的主 Agent
内容：阅读任务 → 写执行计划 → 可选附 extraSteps JSON
requiresApproval: true → 学员确认后后续步骤解锁

extraSteps 格式：
{
  "extraSteps": [
    { "title": "...", "description": "...", "assigneeType": "agent" }
  ]
}
```
