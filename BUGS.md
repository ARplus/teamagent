# TeamAgent Bug 列表

> 由 TestRunner 发现，Lobster 维护。修复后在对应条目打勾。
> 严重度：🔴 P0（上线前必修）/ 🟠 P1（强烈建议）/ 🟡 P2-P3（迭代修）

---

## 🔴 P0 — 上线前必须修复

### BUG-001 pickup-token 竞态条件（Race Condition）
- **文件**：`src/app/api/agent/pickup-token/route.ts`
- **描述**：`findUnique` + `update` 两步非原子，并发轮询时同一 Token 可能被发放两次
- **复现**：两个进程在 < 5ms 内同时请求相同 agentId
- **影响**：Token 双发，安全漏洞
- **修复方案**：用 `prisma.$transaction` + 原子 `updateMany WHERE pendingApiToken IS NOT NULL`
- **状态**：✅ 已修复（2026-02-20）

---

### BUG-002 submit 多步写无事务保护
- **文件**：`src/app/api/steps/[id]/submit/route.ts`
- **描述**：`create(StepSubmission)` → `update(TaskStep)` → `createMany(Attachment)` 三步无事务，任意步失败不回滚
- **影响**：数据孤岛（如 Submission 存在但步骤状态未更新）
- **修复方案**：三步包进 `prisma.$transaction([...])`
- **状态**：✅ 已修复（2026-02-20）

---

## 🟠 P1 — 上线前强烈建议

### BUG-003 AI Summary 阻塞主流程
- **文件**：`src/app/api/steps/[id]/submit/route.ts`
- **描述**：`generateSummary` 是同步 `await`，AI 服务延迟直接阻塞 API 响应
- **影响**：Vercel/serverless 环境下 10s 超时，用户提交步骤可能失败
- **修复方案**：改为异步后台任务（队列或 `after()` hook）
- **状态**：⬜ 待修复

---

## 🟡 P2 — 安全加固

### BUG-004 pickup-token 无认证
- **文件**：`src/app/api/agent/pickup-token/route.ts`
- **描述**：任何知道 agentId 的调用方都能取走 Token（security by obscurity）
- **修复方案**：为轮询接口增加短期签名或限制同 IP
- **状态**：⬜ 待修复

---

## 🟡 P3 — 代码质量

### BUG-005 工作流失败被静默吞掉
- **文件**：`src/app/api/steps/[id]/submit/route.ts`
- **描述**：`processWorkflowAfterSubmit` 失败只打印错误不上报，可观测性差
- **修复方案**：接入错误监控或至少记录到数据库
- **状态**：⬜ 待修复

### BUG-006 result 为空时默认值语义模糊
- **文件**：`src/app/api/steps/[id]/submit/route.ts`
- **描述**：`result` 未提供时默认填 `"任务已完成，等待审核"`，对用户不透明
- **修复方案**：前端强制要求填写 result，或显示 "（未填写提交说明）"
- **状态**：⬜ 待修复

---

*最后更新：2026-02-20 by Lobster 🦞 & TestRunner 🧪*
