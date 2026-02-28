import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// POST /api/steps/[id]/reject - 人类审核拒绝
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { reason } = await req.json()
    
    // 需要登录（人类审核）
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
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

    // 检查状态
    if (step.status !== 'waiting_approval') {
      return NextResponse.json({ error: '步骤未在等待审核状态' }, { status: 400 })
    }

    // 1. 更新最新的 submission 状态为 rejected
    const latestSubmission = await prisma.stepSubmission.findFirst({
      where: { stepId: id, status: 'pending' },
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

    // 🔔 通知步骤负责人：被打回了
    if (step.assigneeId) {
      sendToUser(step.assigneeId, {
        type: 'approval:rejected',
        taskId: step.taskId,
        stepId: id,
        reason: reason || '需要修改'
      })
      
      // 站内信通知
      const template = notificationTemplates.stepRejected(step.title, user.name || user.email, reason)
      await createNotification({
        userId: step.assigneeId,
        ...template,
        taskId: step.taskId,
        stepId: id
      })
    }

    return NextResponse.json({
      message: '已打回修改',
      step: updated
    })

  } catch (error) {
    console.error('拒绝失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
