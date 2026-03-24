import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'
import { applyXPChange, findAgentByUserId, XP_STEP_REJECTED } from '@/lib/agent-growth'
import { authenticateRequest } from '@/lib/api-auth'

// POST /api/steps/[id]/reject - 审核拒绝（支持人类 session 和 Agent token）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { reason } = await req.json()

    // 统一鉴权：Agent token 优先，fallback session
    let user: { id: string; name: string | null; email: string } | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      user = tokenAuth.user
    } else {
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      user = await prisma.user.findUnique({ where: { email: session.user.email } })
    }

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // B08: 权限检查 — 任务创建者 or 步骤负责人 or StepAssignee 成员
    const isAssignee = await prisma.stepAssignee.findFirst({ where: { stepId: id, userId: user.id } })
    if (step.task.creatorId !== user.id && step.assigneeId !== user.id && !isAssignee) {
      return NextResponse.json({ error: '无权审核此步骤' }, { status: 403 })
    }

    // 检查状态（允许任务创建者覆盖打回已自动通过的 done 步骤）
    const isDoneOverride = step.status === 'done' && step.task.creatorId === user.id
    if (step.status !== 'waiting_approval' && !isDoneOverride) {
      return NextResponse.json({ error: '步骤未在等待审核状态' }, { status: 400 })
    }

    // 1. 更新最新的 submission 状态为 rejected（done 覆盖时找 approved 记录）
    const latestSubmission = await prisma.stepSubmission.findFirst({
      where: { stepId: id, status: isDoneOverride ? 'approved' : 'pending' },
      orderBy: { createdAt: 'desc' }
    })

    if (latestSubmission) {
      await prisma.stepSubmission.update({
        where: { id: latestSubmission.id },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: user.id,
          reviewNote: reason || '需要修改'
        }
      })
    }

    // 2. 更新步骤状态 - 打回修改（不清空 result，保留历史！）
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'pending', // 打回后重新等待领取
        agentStatus: 'pending', // Agent 需要重新领取
        // result: null,  ← 不再清空！保留最后一次的结果
        rejectedAt: new Date(),
        rejectionReason: reason || '需要修改',
        completedAt: null, // 清空完成时间
        rejectionCount: { increment: 1 }, // 增加打回次数
        // 重置时间（下次执行重新计时）
        startedAt: null,
        reviewStartedAt: null,
        agentDurationMs: null,
        humanDurationMs: null
      }
    })

    // B08: 打回时重置所有 StepAssignee 状态
    await prisma.stepAssignee.updateMany({
      where: { stepId: id },
      data: { status: 'pending', submittedAt: null, result: null }
    })

    // 🆕 Growth: 打回 → 扣 XP（静默，不发 SSE）
    if (step.assigneeId) {
      try {
        const agentId = await findAgentByUserId(step.assigneeId)
        if (agentId) {
          await applyXPChange(agentId, XP_STEP_REJECTED, `rejected:${step.title}`)
        }
      } catch (e: any) {
        console.warn('[Reject/Growth] XP 扣减失败:', e?.message)
      }
    }

    // 🔔 通知步骤负责人：被打回了
    if (step.assigneeId) {
      // 影子军团：若 assignee 是子 Agent，找主 Agent 一并通知
      const assigneeAgent = await prisma.agent.findUnique({
        where: { userId: step.assigneeId },
        select: { id: true, name: true, soul: true, parentAgentId: true }
      }).catch(() => null)
      const parentUserId = assigneeAgent?.parentAgentId
        ? await prisma.agent.findUnique({
            where: { id: assigneeAgent.parentAgentId },
            select: { userId: true }
          }).then(a => a?.userId ?? null).catch(() => null)
        : null

      // 1. 先发 approval:rejected（告知原因，Watch 端 dedup.unseen 清除去重记录）
      const rejectedPayload = {
        type: 'approval:rejected',
        taskId: step.taskId,
        stepId: id,
        reason: reason || '需要修改'
      }
      sendToUser(step.assigneeId, rejectedPayload as any)
      if (parentUserId && parentUserId !== step.assigneeId) {
        sendToUser(parentUserId, rejectedPayload as any)
      }

      // 2. 再推步骤事件，触发 Agent 重新执行
      // 子 Agent 收到 step:ready，主 Agent (Watch) 收到 step:delegated（走 isolated session）
      const isSubAgent = !!assigneeAgent?.parentAgentId

      sendToUser(step.assigneeId, {
        type: 'step:ready' as const,
        taskId: step.taskId,
        stepId: id,
        title: step.title,
        assigneeType: 'agent',
        assigneeName: assigneeAgent?.name || undefined,
        assigneeSoul: assigneeAgent?.soul || undefined,
        taskMode: (step.task as any).mode || 'solo',  // ⚠️ 必须带 taskMode，否则 Team 模式 Watch 走 shadow spawn 抢占步骤
        rejectionReason: reason || '需要修改',
        rejectionCount: updated.rejectionCount,
      } as any)

      // 3. 影子军团：主 Agent 收到 step:delegated（而非 step:ready），触发 isolated session 重新执行
      if (parentUserId && parentUserId !== step.assigneeId && isSubAgent) {
        sendToUser(parentUserId, {
          type: 'step:delegated',
          taskId: step.taskId,
          stepId: id,
          title: step.title,
          assigneeType: 'agent',
          assigneeName: assigneeAgent?.name || undefined,
          assigneeSoul: assigneeAgent?.soul || undefined,
          assigneeUserId: step.assigneeId,
          taskMode: (step.task as any).mode || 'solo',
          rejectionReason: reason || '需要修改',
          rejectionCount: updated.rejectionCount,
          isRejectionRetry: true,
        } as any)
      }

      // 站内信通知
      const template = notificationTemplates.stepRejected(step.title, user.name || user.email, reason)
      await createNotification({
        userId: step.assigneeId,
        ...template,
        taskId: step.taskId,
        stepId: id
      })
    }

    console.log(`[Reject] 步骤 "${step.title}" 已打回（第${updated.rejectionCount}次），已推 approval:rejected + step:ready/step:delegated 通知 Agent 重新执行`)

    return NextResponse.json({
      message: '已打回修改',
      step: updated
    })

  } catch (error) {
    console.error('拒绝失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
