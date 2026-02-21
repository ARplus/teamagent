import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// POST /api/steps/[id]/approve - 人类审核通过
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
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

    // 检查权限（任务创建者或步骤负责人可以审核）
    if (step.task.creatorId !== user.id && step.assigneeId !== user.id) {
      return NextResponse.json({ error: '无权审核此步骤' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'waiting_approval') {
      return NextResponse.json({ error: '步骤未在等待审核状态' }, { status: 400 })
    }

    // 计算人类审批时间
    const now = new Date()
    const humanDurationMs = step.reviewStartedAt
      ? now.getTime() - new Date(step.reviewStartedAt).getTime()
      : null

    // 1. 更新最新的 submission 状态为 approved
    const latestSubmission = await prisma.stepSubmission.findFirst({
      where: { stepId: id, status: 'pending' },
      orderBy: { createdAt: 'desc' }
    })

    if (latestSubmission) {
      await prisma.stepSubmission.update({
        where: { id: latestSubmission.id },
        data: {
          status: 'approved',
          reviewedAt: now,
          reviewedBy: user.id
        }
      })
    }

    // 2. 更新步骤状态
    // 注意：completedAt 不在这里更新——它在 submit 时已记录 Agent 提交时间，审批不应覆盖
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'done',
        agentStatus: null,
        approvedAt: now,
        approvedBy: user.id,
        humanDurationMs
      }
    })

    // 更新任务的总时间统计
    const allSteps = await prisma.taskStep.findMany({
      where: { taskId: step.taskId },
      select: { agentDurationMs: true, humanDurationMs: true }
    })
    
    const totalAgentTimeMs = allSteps.reduce((sum, s) => sum + (s.agentDurationMs || 0), 0)
    const totalHumanTimeMs = allSteps.reduce((sum, s) => sum + (s.humanDurationMs || 0), 0)
    const totalTime = totalAgentTimeMs + totalHumanTimeMs
    const agentWorkRatio = totalTime > 0 ? totalAgentTimeMs / totalTime : null

    await prisma.task.update({
      where: { id: step.taskId },
      data: { totalAgentTimeMs, totalHumanTimeMs, agentWorkRatio }
    })

    // 检查是否有下一个步骤需要通知
    const nextStep = await prisma.taskStep.findFirst({
      where: {
        taskId: step.taskId,
        order: step.order + 1
      }
    })

    // 如果有下一步且有负责人，更新其 Agent 状态为 pending
    if (nextStep?.assigneeId) {
      await prisma.taskStep.update({
        where: { id: nextStep.id },
        data: { agentStatus: 'pending' }
      })

      // 🔔 通知下一步的 Agent：轮到你了！
      sendToUser(nextStep.assigneeId, {
        type: 'step:ready',
        taskId: step.taskId,
        stepId: nextStep.id,
        title: nextStep.title
      })
    }

    // 🔔 通知当前步骤负责人：已审核通过
    if (step.assigneeId) {
      sendToUser(step.assigneeId, {
        type: 'approval:granted',
        taskId: step.taskId,
        stepId: step.id
      })
      
      // 站内信通知
      const template = notificationTemplates.stepApproved(step.title, user.name || user.email)
      await createNotification({
        userId: step.assigneeId,
        ...template,
        taskId: step.taskId,
        stepId: step.id
      })
    }

    // 检查任务是否全部完成
    const remainingSteps = await prisma.taskStep.count({
      where: {
        taskId: step.taskId,
        status: { not: 'done' }
      }
    })

    if (remainingSteps === 0) {
      // 任务完成 — 生成自动摘要
      const allDoneSteps = await prisma.taskStep.findMany({
        where: { taskId: step.taskId },
        include: { assignee: { select: { name: true } } },
        orderBy: { order: 'asc' }
      })
      
      // 统计参与成员（去重）
      const members = [...new Set(
        allDoneSteps
          .map(s => s.assignee?.name)
          .filter(Boolean)
      )]

      // 格式化时间
      const fmtTime = (ms: number | null) => {
        if (!ms) return '—'
        const h = Math.floor(ms / 3600000)
        const m = Math.floor((ms % 3600000) / 60000)
        return h > 0 ? `${h}h ${m}m` : `${m}m`
      }

      const finalTask = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { totalAgentTimeMs: true, totalHumanTimeMs: true, agentWorkRatio: true }
      })

      const agentPct = finalTask?.agentWorkRatio != null
        ? `${Math.round(finalTask.agentWorkRatio * 100)}%`
        : '—'
      const humanPct = finalTask?.agentWorkRatio != null
        ? `${Math.round((1 - finalTask.agentWorkRatio) * 100)}%`
        : '—'

      const doneCount = allDoneSteps.filter(s => s.status === 'done').length
      const skippedCount = allDoneSteps.filter(s => s.status === 'skipped').length

      // 取开始时间（最早步骤的 startedAt 或任务创建时间）
      const taskFull = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { createdAt: true }
      })
      const startTime = taskFull?.createdAt
        ? taskFull.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—'
      const endTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

      // 产出物：done 步骤的标题（最多 6 个）
      const outputs = allDoneSteps
        .filter(s => s.status === 'done')
        .slice(0, 6)
        .map(s => s.title)

      const autoSummary = [
        `开始：${startTime}`,
        `完成：${endTime}`,
        `产出物：${outputs.join('、')}`,
      ].join('\n')

      await prisma.task.update({
        where: { id: step.taskId },
        data: { status: 'done', autoSummary }
      })
      
      // 通知任务创建者任务已完成
      const template = notificationTemplates.taskCompleted(step.task.title)
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.taskId
      })
    }

    // 如果任务完成，读取 autoSummary 返回给前端
    let taskAutoSummary: string | null = null
    if (remainingSteps === 0) {
      const completedTask = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { autoSummary: true }
      })
      taskAutoSummary = completedTask?.autoSummary ?? null
    }

    return NextResponse.json({
      message: '审核通过',
      step: updated,
      nextStep: nextStep ? {
        id: nextStep.id,
        title: nextStep.title,
        assigneeId: nextStep.assigneeId
      } : null,
      taskCompleted: remainingSteps === 0,
      autoSummary: taskAutoSummary
    })

  } catch (error) {
    console.error('审核失败:', error)
    return NextResponse.json({ error: '审核失败' }, { status: 500 })
  }
}
