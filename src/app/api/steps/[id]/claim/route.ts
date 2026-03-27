import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { extractIdempotencyKey, checkIdempotency, saveIdempotency } from '@/lib/idempotency'

// POST /api/steps/[id]/claim - Agent 领取步骤
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // A2A: 幂等键检查 — 防止重复领取
    const idempotencyKey = extractIdempotencyKey(req)
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey)
      if (cached.hit) {
        return NextResponse.json(cached.cachedBody, { status: cached.cachedStatus })
      }
    }

    const tokenAuth = await authenticateRequest(req)
    
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // B08: 多人指派权限检查
    const stepAssignees = await prisma.stepAssignee.findMany({ where: { stepId: id } })

    // 影子军团：检查当前 Agent 是否是某个被分配子 Agent 的主 Agent
    let isParentAgentOfAssignee = false
    let subAgentUserIdsForStep: string[] = []
    if (stepAssignees.length > 0) {
      const requestingAgent = await prisma.agent.findUnique({
        where: { userId: tokenAuth.user.id },
        select: { id: true, parentAgentId: true }
      })
      if (requestingAgent && !requestingAgent.parentAgentId) {
        // 当前是主 Agent（无 parentAgentId）→ 检查是否有子 Agent 被分配了此步骤
        subAgentUserIdsForStep = await prisma.agent.findMany({
          where: { parentAgentId: requestingAgent.id },
          select: { userId: true }
        }).then(agents => agents.map(a => a.userId).filter((id): id is string => !!id))
        isParentAgentOfAssignee = stepAssignees.some(a => subAgentUserIdsForStep.includes(a.userId))
      }
    }

    if (stepAssignees.length > 0) {
      // 有 StepAssignee 记录 → 被指派的人 或 主Agent（代子Agent）可以领取
      const isAssigned = stepAssignees.some(a => a.userId === tokenAuth.user.id)
      if (!isAssigned && !isParentAgentOfAssignee) {
        return NextResponse.json({ error: '此步骤已分配给其他人' }, { status: 403 })
      }
    } else {
      // 旧路径：没有 StepAssignee 记录（老数据兼容）
      if (step.assigneeId !== null && step.assigneeId !== tokenAuth.user.id) {
        // 检查是否是 assignee 子 Agent 的主 Agent（影子军团兼容）
        let isParentOfAssignee = false
        const requestingAgent = await prisma.agent.findUnique({
          where: { userId: tokenAuth.user.id },
          select: { id: true, parentAgentId: true }
        })
        if (requestingAgent && !requestingAgent.parentAgentId) {
          const assigneeAgent = await prisma.agent.findUnique({
            where: { userId: step.assigneeId },
            select: { parentAgentId: true }
          })
          isParentOfAssignee = assigneeAgent?.parentAgentId === requestingAgent.id
        }
        if (!isParentOfAssignee) {
          return NextResponse.json({ error: '此步骤已分配给其他人' }, { status: 403 })
        }
      }
    }

    // 检查状态
    if (step.status === 'in_progress') {
      // 幂等检查：步骤已是 in_progress — 若属于当前 Agent，直接返回上下文（供 Watch 补拉使用）
      const isMyInProgressStep = step.assigneeId === tokenAuth.user.id ||
        stepAssignees.some(a => a.userId === tokenAuth.user.id) ||
        isParentAgentOfAssignee
      if (isMyInProgressStep) {
        const fullStep = await prisma.taskStep.findUnique({
          where: { id },
          include: { task: { include: { steps: { orderBy: { order: 'asc' } } } }, attachments: true }
        })
        if (!fullStep) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
        const isTeamTaskIdempotent = (fullStep.task as any).mode === 'team'
        const previousSteps = fullStep.task.steps
          .filter(s => {
            if (s.order >= fullStep.order) return false
            if (!s.result) return false
            if (!['done', 'approved', 'waiting_approval'].includes(s.status)) return false
            // Team 模式：waiting_approval 的步骤只有 assignee 本人可见（与主路径保持一致）
            if (isTeamTaskIdempotent && s.status === 'waiting_approval') {
              if (s.assigneeId !== tokenAuth.user.id) return false
            }
            return true
          })
          .map(s => ({ order: s.order, title: s.title, result: s.result, summary: s.summary }))
        return NextResponse.json({
          message: '步骤已在进行中，直接 submit 即可',
          step: fullStep,
          context: {
            taskTitle: fullStep.task.title,
            taskDescription: fullStep.task.description,
            currentStep: {
              order: fullStep.order,
              title: fullStep.title,
              description: fullStep.description,
              inputs: fullStep.inputs,
              outputs: fullStep.outputs,
              skills: fullStep.skills
            },
            rejection: fullStep.rejectionReason ? {
              reason: fullStep.rejectionReason,
              previousResult: null,
              rejectedAt: fullStep.rejectedAt
            } : null,
            previousOutputs: previousSteps,
            allSteps: fullStep.task.steps.map(s => ({
              order: s.order,
              title: s.title,
              status: s.status,
              assigneeNames: s.assigneeNames
            }))
          }
        })
      }
    }
    if (step.status !== 'pending' && step.status !== 'waiting_human') {
      return NextResponse.json({ error: '步骤已被领取或已完成' }, { status: 400 })
    }
    // waiting_human 步骤被 Agent claim 时自动转为 in_progress
    if (step.status === 'waiting_human') {
      await prisma.taskStep.update({ where: { id }, data: { status: 'pending' } })
    }

    // B-000: 串行顺序强制 — 前序步骤未完成时不能领取
    const allSteps = await prisma.taskStep.findMany({
      where: { taskId: step.taskId },
      select: { id: true, order: true, status: true, parallelGroup: true },
      orderBy: { order: 'asc' },
    })
    const myGroup = step.parallelGroup
    const blockers = allSteps.filter(s => {
      if (s.order >= step.order) return false          // 只看前序
      if (['done', 'completed', 'approved', 'skipped', 'waiting_approval', 'waiting_human'].includes(s.status)) return false  // 已完成/跳过/待审批/等人工不阻塞
      // 同一 parallelGroup 的不阻塞（并行步骤互不等待，in_progress 也算正常推进中）
      if (myGroup && s.parallelGroup === myGroup) return false
      // in_progress：同组的兄弟正在执行，属于正常并行状态，不阻塞（上行已处理）
      // 跨组的 in_progress 才需要阻塞（前序步骤还没完成）
      return true
    })
    if (blockers.length > 0) {
      const names = blockers.map(b => `步骤${b.order}`).join('、')
      return NextResponse.json({ error: `前序步骤未完成（${names}），请按顺序执行` }, { status: 409 })
    }

    // B08: 更新 StepAssignee 状态
    const myAssignee = stepAssignees.find(a => a.userId === tokenAuth.user.id)
    if (isParentAgentOfAssignee && !myAssignee) {
      // 影子军团代 claim：不新增主 Agent 的 StepAssignee，只把子 Agent 的记录改为 in_progress
      // 保持 assigneeId 不变（子 Agent 的 userId），避免破坏下游步骤完成逻辑
      const subAgentAssignee = stepAssignees.find(a => subAgentUserIdsForStep.includes(a.userId))
      if (subAgentAssignee) {
        await prisma.stepAssignee.update({
          where: { id: subAgentAssignee.id },
          data: { status: 'in_progress' }
        })
      }
    } else if (myAssignee) {
      await prisma.stepAssignee.update({
        where: { id: myAssignee.id },
        data: { status: 'in_progress' }
      })
    } else {
      // 无记录时创建（旧数据兼容 / 自由领取）
      await prisma.stepAssignee.create({
        data: { stepId: id, userId: tokenAuth.user.id, isPrimary: true, assigneeType: 'agent' }
      }).catch(() => {}) // unique constraint 冲突忽略
    }

    // 更新步骤状态（影子军团代 claim：保留原 assigneeId，不覆盖为主 Agent）
    const finalAssigneeId = (isParentAgentOfAssignee && !myAssignee) ? step.assigneeId : tokenAuth.user.id
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        assigneeId: finalAssigneeId,  // 代 claim 时保持子 Agent userId
        status: 'in_progress',
        agentStatus: 'working',
        startedAt: new Date()
      },
      include: {
        task: {
          include: {
            steps: { orderBy: { order: 'asc' } }
          }
        },
        attachments: true
      }
    })

    // 更新 Agent 状态
    await prisma.agent.update({
      where: { userId: tokenAuth.user.id },
      data: { status: 'working' }
    })

    // 🔔 通知任务创建者：有人领取了步骤
    if (updated.task.creatorId && updated.task.creatorId !== tokenAuth.user.id) {
      sendToUser(updated.task.creatorId, {
        type: 'step:assigned',
        taskId: updated.task.id,
        stepId: id,
        title: updated.title
      })
    }

    // 获取前序步骤的产出（作为本步骤的输入）
    // Team 任务：waiting_approval 状态的步骤结果对另一方不可见（审批前保密）
    // Solo 任务：waiting_approval 可见（单方任务无需隐藏）
    const isTeamTask = (updated.task as any).mode === 'team'
    const previousSteps = updated.task.steps
      .filter(s => {
        if (s.order >= updated.order) return false
        if (!s.result) return false
        if (!['done', 'approved', 'waiting_approval'].includes(s.status)) return false
        // Team 模式：waiting_approval 的步骤只有 assignee 本人才能在 claim 时看到
        // 另一方 claim 自己的步骤时，不得在 previousOutputs 中看到对方未审批的内容
        if (isTeamTask && s.status === 'waiting_approval') {
          const isMyStep = s.assigneeId === tokenAuth.user.id ||
            stepAssignees.some(a => a.userId === tokenAuth.user.id)
          if (!isMyStep) return false
        }
        return true
      })
      .map(s => ({
        order: s.order,
        title: s.title,
        result: s.result,
        summary: s.summary
      }))

    const responseBody = {
      message: '已领取步骤',
      step: updated,
      context: {
        // 任务信息
        taskTitle: updated.task.title,
        taskDescription: updated.task.description,
        
        // 当前步骤
        currentStep: {
          order: updated.order,
          title: updated.title,
          description: updated.description,
          inputs: updated.inputs,
          outputs: updated.outputs,
          skills: updated.skills
        },
        
        // 如果是被打回的，提供打回原因
        rejection: updated.rejectionReason ? {
          reason: updated.rejectionReason,
          previousResult: null, // 已清空
          rejectedAt: updated.rejectedAt
        } : null,
        
        // 前序步骤的产出（本步骤的输入依赖）
        previousOutputs: previousSteps,
        
        // 所有步骤概览
        allSteps: updated.task.steps.map(s => ({
          order: s.order,
          title: s.title,
          status: s.status,
          assigneeNames: s.assigneeNames
        }))
      }
    }

    // A2A: 保存幂等缓存
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'POST', `/api/steps/${id}/claim`, 200, responseBody)
    }

    return NextResponse.json(responseBody)

  } catch (error) {
    console.error('领取步骤失败:', error)
    return NextResponse.json({ error: '领取失败' }, { status: 500 })
  }
}
