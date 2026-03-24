# TeamAgent 硬指令 & BYOA 完整手册

> 版本：V1.7.4（2026-03-14）
> 用途：升级改版时快速定位硬指令位置，禁止全局扫描查找
> 维护：每次修改硬指令后同步更新本文档

---

## 一、执行规范（通用6条）

所有硬指令均携带或传递以下执行规范。修改时需同步更新所有出现位置（见第四节）。

```
1. 优先调用已有 Skill，不重新实现
2. 若 Skill 需要 Token/Key/登录，在提交中注明，等人类单独回复后再继续
3. 提交时必须附可验证的输出（文件路径、命令结果、截图或 URL），不能只写"已完成"
4. 同一操作失败超过 2 次，停止并写明错误和卡点，等人类判断
5. 步骤有依赖时，确认上一步结果后再执行，不跳过
6. 任务描述明确要求提交附件，或产出物为文件/图片/视频/报告时，提交时必须附上实际附件（文件路径或 URL），不可仅用文字描述代替
```

---

## 二、BYOA 流程（Bring Your Own Agent）

### 超时常量
**文件：** `src/lib/decompose-orchestrator.ts`  **行：335–336**

```typescript
const BYOA_AGENT_TIMEOUT_MS  = 3 * 60 * 1000   // 3min：等 Agent 响应
const BYOA_BROADCAST_WAIT_MS = 2 * 60 * 1000   // 再 2min：广播后等其他 Agent 接单
```

### Solo 任务流程
**文件：** `src/app/api/tasks/route.ts`  **行：392–438**

```
创建时检查 Agent 在线状态
  ├─ 在线 → SSE step:ready 给主 Agent
  └─ 离线 → SSE task:waiting-agent + DB notification 给创建者
  ↓ 3min 后（setTimeout）
  └─ 步骤仍 pending → 再次发 task:waiting-agent SSE + DB notification
  ✖ 无 Qianwen 降级，无广播（私密任务）
```

### Team 任务流程
**文件：** `src/lib/decompose-orchestrator.ts`  **行：405–513**

```
创建时
  ├─ 主 Agent 在线 → SSE task:decompose-request
  └─ 主 Agent 离线 → SSE task:waiting-agent + DB notification 给创建者
  ↓ 3min 后（BYOA_AGENT_TIMEOUT_MS）
  ├─ task.decomposeStatus 已非 pending → 跳过（已有人处理）
  └─ 仍 pending → 广播 task:decompose-available 给工作区所有在线 Agent
       + step.assigneeId 置为 null（开放接单）
       + SSE task:waiting-agent + DB notification 给创建者（广播中）
       ↓ 再 2min（BYOA_BROADCAST_WAIT_MS）
       ├─ decomposeStatus 已非 pending → 跳过
       └─ 仍 pending → SSE task:decompose-failed + DB notification 给创建者

  若工作区无其他在线 Agent → 直接 SSE task:decompose-failed + DB notification
```

### 广播接单（任意 Agent 执行 decompose）
**文件：** `src/app/api/steps/[id]/execute-decompose/route.ts`  **行：112–148**

```
原来：step.assigneeId !== userId → 403
现在：
  assigneeId 有值 → 只允许本人执行（不变）
  assigneeId = null（广播） → 验证调用者是工作区成员即可
    → 认领：将 assigneeId 设为本人
    → 通知创建者：task:decompose-claimed（Agent X 接单了）
```

### 新增事件类型
**文件：** `src/lib/events.ts`

| 事件 | 触发时机 | 接收方 | DB通知 |
|---|---|---|---|
| `task:decompose-available` | Team 任务 3min 无响应后广播 | 工作区所有在线 Agent | ✗ |
| `task:decompose-claimed` | 广播步骤被某 Agent 接单 | 任务创建者 | ✗ |
| `task:waiting-agent` | Agent 离线 / 广播中 / 3min超时 | 任务创建者 | ✅ V1.7.3 |
| `task:decompose-failed` | 5min 内无人接单 | 任务创建者 | ✅ V1.7.3 |
| `task:completed` | 所有步骤完成、任务自动变 done | 任务创建者 | ✅ |
| `step:ready` | 步骤分配给 Agent，进入 pending | 步骤负责人 | ✅ V1.7.3 |
| `step:unassigned` | 拆解后步骤无法匹配成员 | 任务创建者 | ✗ |

### 通知持久化（V1.7.3 实现）
> 修复前所有 SSE 均为「发后即忘」，Agent/用户断线后通知永久丢失。

**服务端已实现（2026-03-13）：**

| 文件 | 新增位置 | 写入通知内容 |
|---|---|---|
| `src/lib/step-scheduling.ts` | `activateAndNotifySteps()` 内 | 📝 新步骤分配（每个被分配人） |
| `src/lib/decompose-orchestrator.ts` | 4处 `task:waiting-agent` / `task:decompose-failed` | ⏳ 等待 Agent 响应 / ⚠️ 拆解超时 |
| `src/app/api/tasks/route.ts` | 2处 Solo `task:waiting-agent` | ⏳ 等待 Agent 响应 |

**客户端待实现（⚠️ 已知缺口）：**
```
SSE 重连后，客户端应调用 /api/my/available-steps 补齐断线期间漏掉的步骤。
当前行为：重连后只等新 SSE 推送，无主动拉取机制。
```

---

## 三、硬指令入口清单

### #1 Solo 任务创建 — 拆解步骤描述
**文件：** `src/app/api/tasks/route.ts`  **行：347**
**触发：** 用户在任务创建页选 Solo → 提交

**内容（拆解要求 + 执行规范 + 附加要求）：**
```
拆解要求：
1. 拆解为可独立执行的子步骤
2. 为每步指定最合适的 assignee（Agent名字）
3. 判断哪些步骤可以并行（parallelGroup 相同字符串）
4. 判断每步是否需要人类审批（requiresApproval）
5. 返回 JSON 格式步骤数组

执行规范（每步必须遵守，请写入各步骤 description）：
[通用6条]

拆解附加要求：
- assignee 禁止为空，每步必须有明确责任人
- assigneeType="human" 仅限需人类亲自完成（签署/付款/物理操作），审核/放行类步骤用 requiresApproval:true 代替
```

---

### #2 Team 任务创建 — SSE 事件推送
**文件：** `src/lib/decompose-orchestrator.ts`  **行：405–420**
**触发：** 用户在任务创建页选 Team → 提交（`decomposerType=main-agent`）
**说明：** 本条只负责发 SSE，实际 prompt 由 #7 构建

---

### #3 聊天框创建 Solo 任务 — 拆解步骤描述
**文件：** `src/app/api/tasks/create-from-chat/route.ts`  **行：163**
**触发：** 聊天页 AI 识别到 Solo 任务意图 → 创建任务
**内容：** 同 #1（完全一致，含附加要求）

---

### #4 使用模板（Run Template）— 执行规范注入
**文件：** `src/app/api/templates/[id]/run/route.ts`  **行：227–238**
**触发：** 模板详情页 → 「使用模板」按钮

**机制（P0-1 修复）：**
```
步骤实例化完成后，对所有非 human 步骤统一补注执行规范：
  ├─ stepsTemplate[i].assigneeRole === 'human' → 跳过（人类无需规范）
  ├─ description 已含 '执行规范（必须遵守）' → 跳过（避免重复，模板已写入）
  └─ 其他 → 追加 EXEC_RULES_FOOTER（通用6条）到 description 末尾

EXEC_RULES_FOOTER 内容 = 通用6条（同 #1）
```

> ⚠️ 原来模板步骤只靠模板作者的 `executionProtocol`，无法保证规范注入。
> P0-1 确保无论模板是否有 `executionProtocol`，6条规范**必定存在**。

---

### #5 步骤进入 Ready 状态 — 执行 Prompt（最重要）
**文件：** `src/lib/agent-auto-execute.ts`  **行：229–370**
**函数：** `buildExecutionPrompt(step, task)`
**触发：** 任意步骤变为 `pending` 且 assignee 为 Agent 时自动调用
**内容结构（按顺序）：**

| 章节 | 行 | 内容 |
|---|---|---|
| **分配来源** | **~253** | **谁做的拆解 + 此步骤分配给你的原因（能力标签匹配）** |
| 打回历史前置 | ~270 | 所有 `rejected` 提交记录，含每次原因和内容 |
| 任务信息 | ~285 | 任务标题 + 描述 |
| 步骤总览 | ~295 | 全部步骤、负责人、状态、并行组 |
| 并行任务说明 | ~310 | 若本步骤在并行组，列出其他并行伙伴 |
| 当前步骤详情 | ~320 | 标题、描述、inputs、outputs、skills |
| 步骤评论 | ~338 | 本步骤所有人类/Agent 评论 |
| 前序步骤产出 | ~349 | 已完成步骤的 result/summary |
| **执行规范** | **~361** | **通用6条（必须遵守）** |
| 要求 | ~369 | 打回时：针对原因重新完成；否则：直接输出成果 |

**分配来源章节：**
```
## 分配来源
- 任务拆解者：[拆解步骤的执行者名字]
- 分配给你的原因：此步骤匹配你的能力标签「[skills 数组]」
- 请基于你的能力完成此步骤，如能力不足请在提交中说明并请求支援
```

---

### #6 步骤完成后工作流检查
**文件：** `src/lib/workflow-engine.ts`  **行：47**
**常量：** `WORKFLOW_CHECK_PROMPT`
**触发：** 步骤标记完成后自动调用
**说明：** AI 判断是否需要 insert/modify/skip 后续步骤，不是执行 prompt，**无需加执行规范**

**V1.7.4 已修复 skip 通知：**
```
skip_step → status='skipped', result='自动跳过: [reason]'
  + DB notification 通知任务创建者：
    「⏭️ 步骤「X」已自动跳过」，内容含跳过原因
```

> `workflow-engine.ts` 行 311 的 `// TODO: 保存到 WorkflowHistory 表` 仍未实现（WorkflowHistory 表还未建），通知已补上。

---

### #7 Agent 执行拆解 API — 最详细系统 Prompt
**文件：** `src/app/api/steps/[id]/execute-decompose/route.ts`  **行：191–283**
**触发：** Agent 客户端收到 `task:decompose-request` / `task:decompose-available` 后调用
**内容结构（按章节）：**

| 章节 | 行 | 内容 |
|---|---|---|
| 一、拆解核心规则 | 219 | 一步一人、最小可执行、描述三要素、步骤数量 |
| **二、人员分配规则** | **227** | **assignee 必须是成员、⛔禁止为空、human vs requiresApproval 明确区分** |
| 三、审批判断 | 237 | requiresApproval 判断条件 |
| 四、并行与顺序 | 242 | parallelGroup 规则 |
| 五、禁止事项 | 248 | 6条⛔，包括禁空 assignee |
| 六、技能优先推荐 | 257 | 图片/视频/爬虫等优先查 Skill |
| 七、并行判断规则 | 267 | 顺序/并行写法，并行步骤须注明伙伴 |
| **八、执行规范传递** | **274** | **要求写入每步 description 末尾（通用6条）** |
| 输出格式 | 288 | JSON 数组格式 |

**二、人员分配规则：**
```
assigneeType 选择规则：
- "agent"：步骤由 AI Agent 执行（默认）
- "human"：仅限需要人类亲自完成的步骤（线下签署合同、实体付款、物理操作等）
- ⚠️ 审核/放行/确认类步骤 → 用 requiresApproval: true，assigneeType 仍为 "agent"
⛔ assignee 禁止为空 — 每一步必须有明确责任人，不得遗漏
```

**指定 Agent 不在工作区时的行为（V1.7.4 已修复）：**
**文件：** `src/lib/decompose-orchestrator.ts`  **行：159–192**
```
匹配优先级（从高到低）：
  1. 精确匹配 Agent 名
  2. 精确匹配人名（→ assigneeType=human）
  3. 模糊匹配 Agent 名（包含关系）
  4. 模糊匹配人名（→ assigneeType=human）
  5. matchByCapabilities() — 按能力标签匹配
  6. 🆕 兜底回退：分配给创建者的主 Agent（无则任意主 Agent）
     - description 末尾追加「⚠️ 自动兜底：此步骤指定「X」但未找到匹配成员...」
     - DB notification 通知创建者，内含原指定名和实际分配的 Agent 名
  ✖ 以上全部失败 → step.unassigned=true（极端情况，工作区无任何主 Agent）
```

---

### #8 创建子 Agent — 主 Agent 激活通知
**文件：** `src/app/api/agents/create-sub/route.ts`  **行：150–195**
**触发：** 用户在界面点「创建子 Agent」→ 注册成功后
**接收方：** 主 Agent 的对话频道（`sendChatMessage`）

**内容结构（P0-2 改写，3步结构化指令）：**
```
🤖 新子 Agent「[name]」已在 TeamAgent 注册成功！
Token: [token]
userId: [userId]

## 你需要完成的步骤（按顺序执行）

第一步：在 OpenClaw 中注册子 Agent
调用 Skill「🌊 组建 Agent 军团」，传入 Token → 完成后验证子 Agent 出现在 agents.list

第二步：验证子 Agent 上线
启动子 Agent，Watch 到 agent:online 或收到首次心跳

第三步：回报结果
在此对话中回复：「✅ [name] 已激活，[agentId]，能力：[skills]」

执行规范：
- 优先调用已有 Skill，若 Skill 需要 Token 等待人类提供
- 每步完成后验证结果再进行下一步
```

---

### #9 任务完成后评分 — systemPrompt
**文件：** `src/app/api/tasks/[id]/evaluate/route.ts`  **行：275–320**
**触发：** 任务状态变为 `done` → 自动评分
**评分维度：**

| 维度 | 权重 | 加减分规则 |
|---|---|---|
| quality | 40% | +0.5 可验证输出；+0.5 任务要求附件时实际附上；+0.5 超出预期 |
| | | -1.0 只写"已完成"无证据；-1.0 要求附件但未提交；-0.5/-1.0/-1.5 被打回1/2/3+次 |
| efficiency | 30% | 快速完成 → 高分；超同类平均2倍 → -0.5 到 -1.0 |
| collaboration | 30% | +0.5 并行协作且不重复；+0.5 主动上报问题；-0.5 未按时响应 |

**综合公式：** `overallScore = quality × 0.4 + efficiency × 0.3 + collaboration × 0.3`

---

### #10 步骤自动提交 — 任务自动完成检查
**文件：** `src/app/api/steps/[id]/submit/route.ts`  **行：407–455**
**触发：** `requiresApproval === false` 路径下步骤 submit 后

```
原来：requiresApproval=false 路径只更新步骤状态，不检查任务是否完成
现在：
  → checkAndCompleteParentStep(stepId)
  → remainingSteps = count(status NOT IN ['done','skipped'])
  → if remainingSteps === 0：
      生成 autoSummary（统计步骤数/平均分/总时长）
      task.status → 'done'
      发 task:completed SSE 给创建者
      创建「任务已完成」DB 通知
```

> ⚠️ `approve/route.ts`（`requiresApproval=true` 路径）早已有此逻辑，
> `submit/route.ts`（`requiresApproval=false` 路径）缺失，导致 Lobster 步骤全 done 后任务卡在 `in-progress`。

---

### #A 手动 Parse 接口 — 拆解步骤描述
**文件：** `src/app/api/tasks/[id]/parse/route.ts`  **行：87–104**
**触发：** 任务详情页手动点「AI 拆解」按钮
**内容：** 仅含通用规范前5条，**缺少第6条（附件）+ assignee 附加要求**

> ⚠️ **已知缺口：** #A 未随 V1.7.2 更新，待下轮补齐（低优先级，手动拆解用得少）

---

## 四、修改规范

### 修改执行规范（通用6条）时
需同步更新以下 **6 处**：

| 文件 | 行 | 位置 |
|---|---|---|
| `src/app/api/tasks/route.ts` | 347 | Solo 拆解步骤 description |
| `src/app/api/tasks/create-from-chat/route.ts` | 163 | 聊天创建 Solo description |
| `src/app/api/templates/[id]/run/route.ts` | 230 | EXEC_RULES_FOOTER 常量 |
| `src/lib/agent-auto-execute.ts` | ~361 | 步骤执行 prompt `## 执行规范` |
| `src/app/api/steps/[id]/execute-decompose/route.ts` | 274 | 拆解 prompt 八、执行规范传递 |
| `src/app/api/tasks/[id]/parse/route.ts` | 99 | 手动 Parse description（待补第6条） |

> Skill 包同步更新：`skills/teamagent-client-skill-v17/lib/event-handlers.js`
> → `buildDecomposePrompt()` 函数末尾的执行规范文本

### 修改 BYOA 超时时间时
**文件：** `src/lib/decompose-orchestrator.ts`  **行：335–336**
只改常量，不动逻辑。

### 修改广播判断逻辑时
**文件：** `src/lib/decompose-orchestrator.ts`  **行：445–510**

### 修改广播接单权限时
**文件：** `src/app/api/steps/[id]/execute-decompose/route.ts`  **行：112–148**

### 修改评分权重/维度时
**文件：** `src/app/api/tasks/[id]/evaluate/route.ts`  **行：275–320**
同步更新本文档 `#9` 节中的维度表格。

### 修改通知持久化逻辑时
需同步更新以下 **3 处**：

| 文件 | 函数/位置 | 通知场景 |
|---|---|---|
| `src/lib/step-scheduling.ts` | `activateAndNotifySteps()` | 步骤分配给 Agent |
| `src/lib/decompose-orchestrator.ts` | 4处 waiting/failed 通知 | 等待Agent / 拆解失败 |
| `src/app/api/tasks/route.ts` | 2处 Solo waiting 通知 | Solo等待Agent |

---

## 五、已知待办缺口

| 优先级 | 缺口 | 文件 | 状态 | 说明 |
|---|---|---|---|---|
| ✅ | 客户端 SSE 重连/静默兜底 | `sse-watcher.js` | V1.7.4 skill 已修 | `startStepPoll()` — SSE断线或60s静默时每30s主动捞 pending 步骤 |
| ✅ | unassigned 步骤回退主Agent | `decompose-orchestrator.ts` ~159 | V1.7.4 已修 | 能力匹配也失败 → 自动分配给创建者的主Agent，描述追加说明，DB通知创建者 |
| ✅ | workflow skip audit log | `workflow-engine.ts` ~290 | V1.7.4 已修 | `skip_step` 执行后 DB notification 通知任务创建者，内含跳过原因 |
| ✅ | step:ready 补 DB 通知（Solo在线路径） | `tasks/route.ts` ~396 | V1.7.4 已修 | Agent在线发step:ready时同步写DB通知，Lobster铃铛可见 |
| ✅ | 3min超时 status 判断错误 | `tasks/route.ts` ~421 | V1.7.4 已修 | decompose步创建即`in_progress`，从`==='pending'`改为`!=='done'&&!=='skipped'` |
| ✅ | step:unassigned 补 DB 通知 | `step-scheduling.ts` ~149 | V1.7.4 已修 | 无人认领时DB通知创建者 |
| 🟢 低 | #A parse 补齐规范 | `tasks/[id]/parse/route.ts` | 待修 | 缺第6条+assignee附加要求 |

---

## 六、版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| V1.7.4 | 2026-03-14 | unassigned步骤兜底回退主Agent + DB通知；workflow skip补DB通知；SSE静默30s步骤轮询；Solo在线路径step:ready补DB通知；Solo 3min超时检查status修正（pending→!done）；step:unassigned补DB通知 |
| V1.7.3 | 2026-03-13 | 通知持久化（step:ready/task:waiting-agent/task:decompose-failed 全补 DB 通知）；Lobster review：文档补缺口1–4、事件表加DB列、#6 skip风险、#7 unassigned当前行为 |
| V1.7.2 | 2026-03-13 | 执行规范第6条（附件），human 类型明确区分，分配来源信息，模板执行规范注入（P0-1），子Agent结构化激活通知（P0-2），评分加减分细则（P1），Lobster 任务自动完成（submit路径）|
| V1.7.1 | 2026-03-13 | 初版手册创建 |
