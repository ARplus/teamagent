import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, sendToUsers } from '@/lib/events'
import { processWorkflowAfterSubmit } from '@/lib/workflow-engine'
import { getStartableSteps, activateAndNotifySteps } from '@/lib/step-scheduling'
import { generateSummary } from '@/lib/ai-summary'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// 统一认证：支持 Token 或 Session
async function authenticate(req: NextRequest) {
  // 先尝试 API Token
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  // 尝试 Session（人类用户浏览器访问）
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

/**
 * POST /api/steps/[id]/submit
 *
 * Agent 提交步骤结果，等待人类审核
 *
 * Body:
 * {
 *   result: string,          // 结果描述；decompose 步骤时为 JSON 步骤列表
 *   summary?: string,
 *   attachments?: [{ name: string, url: string, type?: string }]
 * }
 *
 * decompose 步骤格式（result 字段）：
 * [
 *   {
 *     title: string,
 *     description?: string,
 *     assignee?: string,          // Agent 名字（可选）
 *     requiresApproval?: boolean, // 默认 true
 *     parallelGroup?: string,     // 相同字符串 = 并行执行
 *     inputs?: string[],
 *     outputs?: string[],
 *     skills?: string[],
 *     stepType?: 'task' | 'meeting',
 *     agenda?: string,
 *     participants?: string[]
 *   }
 * ]
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { result, summary, attachments } = await req.json()

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true, title: true, creatorId: true, workspaceId: true,
            steps: { select: { id: true, order: true } }
          }
        }
      }
    })

    if (!step) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    // B08: 权限检查 — assigneeId 或 StepAssignee 表中有记录 或 任务创建者
    const stepAssigneeRecord = await prisma.stepAssignee.findUnique({
      where: { stepId_userId: { stepId: id, userId: auth.userId } }
    }).catch(() => null)
    const isTaskCreator = step.task.creatorId === auth.userId
    if (step.assigneeId !== auth.userId && !stepAssigneeRecord && !isTaskCreator) {
      return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    }
    // 允许 pending 和 in_progress 状态提交（人类步骤可能停留在 pending）
    if (step.status !== 'in_progress' && step.status !== 'pending') {
      return NextResponse.json({ error: '步骤不在可提交状态' }, { status: 400 })
    }

    const now = new Date()

    // ================================================================
    // 🔀 decompose 步骤：展开为子步骤
    // ================================================================
    if (step.stepType === 'decompose') {
      let parsedSteps: any[]
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result)
        // 尝试解析：可能是纯 JSON 数组，也可能包在对象里
        const parsed = JSON.parse(raw)
        parsedSteps = Array.isArray(parsed) ? parsed : (parsed.steps ?? [])
        if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
          return NextResponse.json({ error: 'decompose result 需要是非空 JSON 步骤数组' }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: 'result 不是合法 JSON，无法展开步骤' }, { status: 400 })
      }

      // 获取工作区成员（用于 assignee 名字 → userId 匹配）
      const workspaceMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: step.task.workspaceId },
        include: {
          user: {
            select: {
              id: true, name: true, nickname: true,
              agent: { select: { name: true, capabilities: true } }
            }
          }
        }
      })

      function findUserByAgentName(agentName: string): string | null {
        if (!agentName) return null
        const m = workspaceMembers.find(m =>
          (m.user.agent as any)?.name === agentName ||
          (m.user.agent as any)?.name?.includes(agentName) ||
          agentName.includes((m.user.agent as any)?.name || '') ||
          m.user.name === agentName || m.user.nickname === agentName
        )
        return m?.user.id ?? null
      }

      // 当前最大 order（decompose 步骤之后插入）
      const maxOrder = Math.max(...step.task.steps.map(s => s.order), 0)
      let orderOffset = maxOrder

      const createdSteps = []
      const involvedUserIds = new Set<string>()

      for (const s of parsedSteps) {
        orderOffset++
        const assigneeId = s.assignee ? findUserByAgentName(s.assignee) : null
        if (assigneeId) involvedUserIds.add(assigneeId)

        const created = await prisma.taskStep.create({
          data: {
            title: s.title,
            description: s.description || null,
            order: orderOffset,
            taskId: step.task.id,
            stepType: s.stepType || 'task',
            assigneeId,
            assigneeNames: s.assignee ? JSON.stringify([s.assignee]) : null,
            requiresApproval: s.requiresApproval !== false, // 默认 true
            parallelGroup: s.parallelGroup || null,
            inputs: s.inputs?.length ? JSON.stringify(s.inputs) : null,
            outputs: s.outputs?.length ? JSON.stringify(s.outputs) : null,
            skills: s.skills?.length ? JSON.stringify(s.skills) : null,
            agenda: s.agenda || null,
            participants: s.participants?.length ? JSON.stringify(s.participants) : null,
            status: 'pending',
            agentStatus: assigneeId ? 'pending' : null,
          }
        })
        createdSteps.push(created)
      }

      // 将 decompose 步骤标为 done（自动完成，不需要审批）
      await prisma.taskStep.update({
        where: { id },
        data: {
          status: 'done',
          agentStatus: 'done',
          result: `已拆解为 ${createdSteps.length} 个步骤`,
          completedAt: now,
          approvedAt: now,
          agentDurationMs: step.startedAt ? now.getTime() - new Date(step.startedAt).getTime() : null
        }
      })

      // 更新 Agent 状态
      const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } })
      if (agent) await prisma.agent.update({ where: { userId: auth.userId }, data: { status: 'online' } })

      // 通知所有被分配的 Agent（第一个 pending 步骤可以开始了）
      if (involvedUserIds.size > 0) {
        const userIds = Array.from(involvedUserIds)
        sendToUsers(userIds, { type: 'task:created', taskId: step.task.id, title: step.task.title })

        // 通知可以立刻开始的步骤 + 触发 Agent 自动执行
        const startableSteps = getStartableSteps(createdSteps)
        await activateAndNotifySteps(step.task.id, startableSteps as any[])
      }

      // 通知任务创建者
      if (step.task.creatorId) {
        sendToUser(step.task.creatorId, {
          type: 'task:decomposed',
          taskId: step.task.id,
          stepsCount: createdSteps.length
        })
      }

      console.log(`[Decompose] 任务 ${step.task.id} 已拆解为 ${createdSteps.length} 步，通知 ${involvedUserIds.size} 个 Agent`)

      return NextResponse.json({
        message: `✅ 任务已拆解为 ${createdSteps.length} 个步骤，已通知相关 Agent`,
        steps: createdSteps,
        involvedAgents: involvedUserIds.size
      })
    }

    // ================================================================
    // 📋 普通步骤提交（原有逻辑）
    // ================================================================
    const agentDurationMs = step.startedAt ? now.getTime() - new Date(step.startedAt).getTime() : null

    // 自动生成 summary
    let finalSummary = summary
    if (!summary && result) {
      const aiSummary = await generateSummary({
        stepTitle: step.title,
        result: result,
        attachmentCount: attachments?.length || 0
      })
      if (aiSummary) finalSummary = aiSummary
    }

    const resultText = result || '任务已完成，等待审核'

    // B08: 更新该用户的 StepAssignee 状态
    if (stepAssigneeRecord) {
      await prisma.stepAssignee.update({
        where: { id: stepAssigneeRecord.id },
        data: { status: 'submitted', submittedAt: now, result: resultText }
      })
    }

    // B08: 检查多人完成模式
    const allAssignees = await prisma.stepAssignee.findMany({ where: { stepId: id } })
    const isMultiAssignee = allAssignees.length > 1
    let isStepComplete = true // 默认单人模式直接完成

    if (isMultiAssignee) {
      if (step.completionMode === 'any') {
        isStepComplete = true // 任一提交即完成
      } else {
        // "all" 模式：检查是否所有人都已提交
        const allSubmitted = allAssignees.every(a =>
          a.status === 'submitted' || a.userId === auth.userId
        )
        isStepComplete = allSubmitted
      }
    }

    // 多人模式下未全部完成 → 记录部分提交，不改变步骤状态
    if (isMultiAssignee && !isStepComplete) {
      const sub = await prisma.stepSubmission.create({
        data: {
          stepId: id,
          submitterId: auth.userId,
          result: resultText,
          summary: finalSummary || null,
          durationMs: agentDurationMs
        }
      })
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        await prisma.attachment.createMany({
          data: attachments.map((att: { name: string; url: string; type?: string }) => ({
            name: att.name, url: att.url, type: att.type || 'file',
            submissionId: sub.id, uploaderId: auth.userId
          }))
        })
      }
      const done = allAssignees.filter(a => a.status === 'submitted' || a.userId === auth.userId).length
      console.log(`[Submit] 多人步骤 ${id} 部分提交: ${done}/${allAssignees.length}`)
      return NextResponse.json({
        message: `已提交你的部分（${done}/${allAssignees.length}），等待其他成员完成`,
        partial: true,
        progress: { done, total: allAssignees.length }
      })
    }

    const [submission, updated] = await prisma.$transaction(async (tx) => {
      const sub = await tx.stepSubmission.create({
        data: {
          stepId: id,
          submitterId: auth.userId,
          result: resultText,
          summary: finalSummary || null,
          durationMs: agentDurationMs
        }
      })

      const autoApprove = step.requiresApproval === false
      const newStatus = autoApprove ? 'done' : 'waiting_approval'

      const upd = await tx.taskStep.update({
        where: { id },
        data: {
          status: newStatus,
          agentStatus: newStatus,
          result: resultText,
          summary: finalSummary || null,
          completedAt: now,
          reviewStartedAt: autoApprove ? null : now,
          approvedAt: autoApprove ? now : null,
          agentDurationMs
        }
      })

      // B08: 步骤完成时，更新所有 assignee 状态
      if (allAssignees.length > 0) {
        await tx.stepAssignee.updateMany({
          where: { stepId: id },
          data: { status: autoApprove ? 'done' : 'submitted' }
        })
      }

      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((att: { name: string; url: string; type?: string }) => ({
            name: att.name,
            url: att.url,
            type: att.type || 'file',
            submissionId: sub.id,
            uploaderId: auth.userId
          }))
        })
      }

      return [sub, upd]
    })

    // 更新 Agent 状态
    const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } })
    if (agent) await prisma.agent.update({ where: { userId: auth.userId }, data: { status: 'online' } })

    const autoApproved = step.requiresApproval === false

    if (!autoApproved && step.task.creatorId) {
      sendToUser(step.task.creatorId, {
        type: 'approval:requested',
        taskId: step.task.id,
        stepId: id,
        title: step.title
      })
      const submitterName = (auth.user as any).name || (auth.user as any).email
      const template = notificationTemplates.stepWaiting(step.title, step.task.title, submitterName)
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.task.id,
        stepId: id
      })
    }

    sendToUser(auth.userId, {
      type: 'step:completed',
      taskId: step.task.id,
      stepId: id,
      title: step.title
    })

    let workflowResult = null
    try {
      workflowResult = await processWorkflowAfterSubmit(id, result || '', summary)
    } catch (error) {
      console.error('[Submit] 工作流处理失败:', error)
    }

    return NextResponse.json({
      message: autoApproved ? '已提交并自动通过（无需人工审核）' : '已提交，等待人类审核',
      autoApproved,
      step: updated,
      workflow: workflowResult
    })

  } catch (error) {
    console.error('提交步骤失败:', error)
    return NextResponse.json({ error: '提交失败', detail: error instanceof Error ? error.message : '未知错误' }, { status: 500 })
  }
}

// getStartableSteps 已移至 @/lib/step-scheduling 共享模块
