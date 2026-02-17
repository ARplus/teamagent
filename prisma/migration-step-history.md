# StepSubmission 迁移方案

## 问题
- reject 后 result 被清空
- 看不到提交历史
- 看不到审核历史

## 解决方案

### 1. 新增 StepSubmission 模型

```prisma
// 步骤提交记录 - 每次提交都是一条新记录
model StepSubmission {
  id          String   @id @default(cuid())
  
  // 提交内容
  result      String   // 提交的结果
  summary     String?  // AI 摘要
  
  // 审核状态
  status      String   @default("pending") // pending, approved, rejected
  reviewedAt  DateTime?
  reviewedBy  String?   // 审核人 ID
  reviewNote  String?   // 审核备注（通过/拒绝的说明）
  
  // 时间
  createdAt   DateTime @default(now())
  
  // 执行耗时
  durationMs  Int?     // 这次提交的执行时间
  
  // 关联
  stepId      String
  step        TaskStep @relation(fields: [stepId], references: [id], onDelete: Cascade)
  
  submitterId String
  submitter   User     @relation(fields: [submitterId], references: [id])
  
  // 附件
  attachments Attachment[]
}
```

### 2. 修改 TaskStep

```prisma
model TaskStep {
  // ... 保留现有字段
  
  // 新增关联
  submissions StepSubmission[]  // 所有提交记录
  
  // result 字段保留，作为"当前最新结果"的快照
  // 但历史记录在 submissions 里
}
```

### 3. 修改 Attachment

```prisma
model Attachment {
  // ... 现有字段
  
  // 可以属于 Step 或 Submission
  stepId       String?
  step         TaskStep? @relation(fields: [stepId], references: [id], onDelete: Cascade)
  
  submissionId String?
  submission   StepSubmission? @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}
```

## API 修改

### submit/route.ts

```typescript
// 1. 创建 StepSubmission 记录
const submission = await prisma.stepSubmission.create({
  data: {
    stepId: id,
    submitterId: tokenAuth.user.id,
    result: result,
    summary: finalSummary,
    durationMs: agentDurationMs
  }
})

// 2. 更新 Step 状态（result 保留最新的）
await prisma.taskStep.update({
  where: { id },
  data: {
    status: 'waiting_approval',
    result: result,  // 保存最新结果
    // ...
  }
})

// 3. 附件关联到 submission
if (attachments) {
  await prisma.attachment.createMany({
    data: attachments.map(att => ({
      ...att,
      submissionId: submission.id,  // 关联到提交记录
      uploaderId: tokenAuth.user.id
    }))
  })
}
```

### reject/route.ts

```typescript
// 1. 找到最新的 submission
const latestSubmission = await prisma.stepSubmission.findFirst({
  where: { stepId: id, status: 'pending' },
  orderBy: { createdAt: 'desc' }
})

// 2. 更新 submission 状态
if (latestSubmission) {
  await prisma.stepSubmission.update({
    where: { id: latestSubmission.id },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: user.id,
      reviewNote: reason
    }
  })
}

// 3. 更新 Step 状态（不清空 result！）
await prisma.taskStep.update({
  where: { id },
  data: {
    status: 'pending',
    rejectionReason: reason,
    rejectionCount: { increment: 1 },
    // result: null,  ← 删除这行！保留历史
  }
})
```

### approve/route.ts

```typescript
// 1. 更新最新 submission 状态
const latestSubmission = await prisma.stepSubmission.findFirst({
  where: { stepId: id, status: 'pending' },
  orderBy: { createdAt: 'desc' }
})

if (latestSubmission) {
  await prisma.stepSubmission.update({
    where: { id: latestSubmission.id },
    data: {
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: user.id,
      reviewNote: note  // 可选的通过备注
    }
  })
}

// 2. 更新 Step 状态
await prisma.taskStep.update({
  where: { id },
  data: {
    status: 'done',
    approvedAt: new Date(),
    approvedBy: user.id
  }
})
```

## 前端显示

步骤详情页可以显示：
- 提交历史列表（倒序）
- 每次提交的结果、附件、审核状态
- 审核人和审核备注

## 迁移步骤

1. `npx prisma migrate dev --name add_step_submission`
2. 更新 submit/route.ts
3. 更新 reject/route.ts  
4. 更新 approve/route.ts
5. 前端添加历史显示

