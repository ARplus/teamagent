import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// POST /api/steps/[id]/resolve-appeal - 人类裁定申诉
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 必须是登录用户（人类）
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

    const { decision, note } = await req.json()

    if (decision !== 'upheld' && decision !== 'dismissed') {
      return NextResponse.json({ error: 'decision 必须是 upheld 或 dismissed' }, { status: 400 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 只有任务创建者可以裁定
    if (step.task.creatorId !== user.id) {
      return NextResponse.json({ error: '只有任务创建者可以裁定申诉' }, { status: 403 })
    }

    // 必须有 pending 申诉
    if (step.appealStatus !== 'pending') {
      return NextResponse.json({ error: '没有待裁定的申诉' }, { status: 400 })
    }

    // 根据裁定结果更新步骤
    const updateData: Record<string, unknown> = {
      appealStatus: decision,
      appealResolvedAt: new Date()
    }

    if (decision === 'upheld') {
      // 申诉成功：步骤改回 waiting_approval，让人类审批
      updateData.status = 'waiting_approval'
      updateData.agentStatus = 'waiting_approval'
    } else {
      // 申诉驳回：保持 pending（需要重做），rejectionCount++
      updateData.status = 'pending'
      updateData.agentStatus = 'pending'
      updateData.rejectionCount = { increment: 1 }
    }

    const updated = await prisma.taskStep.update({
      where: { id },
      data: updateData
    })

    // 通知步骤负责人
    if (step.assigneeId) {
      sendToUser(step.assigneeId, {
        type: 'appeal:resolved',
        taskId: step.taskId,
        stepId: id,
        decision,
        note
      })

      const template = notificationTemplates.appealResolved(step.title, decision)
      await createNotification({
        userId: step.assigneeId,
        ...template,
        taskId: step.taskId,
        stepId: id
      })
    }

    return NextResponse.json({
      message: decision === 'upheld' ? '申诉已维持，步骤重新进入待审批' : '申诉已驳回，需重新完成',
      step: updated
    })

  } catch (error) {
    console.error('裁定申诉失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
