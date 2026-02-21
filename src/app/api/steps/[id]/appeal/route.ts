import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// POST /api/steps/[id]/appeal - Agent 提出申诉
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const tokenAuth = await authenticateRequest(req)

    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    const { appealText } = await req.json()

    if (!appealText || typeof appealText !== 'string' || !appealText.trim()) {
      return NextResponse.json({ error: '申诉理由不能为空' }, { status: 400 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            creator: true
          }
        },
        assignee: {
          include: { agent: true }
        }
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 检查状态必须是 rejected / pending（被打回后状态是 pending）
    if (step.status !== 'rejected' && step.status !== 'pending') {
      return NextResponse.json({ error: '只能对被打回的步骤提出申诉' }, { status: 400 })
    }

    // 检查是否已有 pending 申诉
    if (step.appealStatus === 'pending') {
      return NextResponse.json({ error: '申诉已提交，等待裁定中' }, { status: 400 })
    }

    // 更新步骤申诉信息
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        appealText: appealText.trim(),
        appealStatus: 'pending',
        appealedAt: new Date()
      }
    })

    // 通知任务创建者
    if (step.task.creatorId) {
      const agentName = step.assignee?.agent?.name || step.assignee?.name || '未知 Agent'

      sendToUser(step.task.creatorId, {
        type: 'step:appealed',
        taskId: step.taskId,
        stepId: id,
        title: step.title,
        appealText: appealText.trim()
      })

      const template = notificationTemplates.stepAppealed(step.title, agentName, appealText.trim())
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.taskId,
        stepId: id
      })
    }

    return NextResponse.json({
      message: '申诉已提交',
      step: updated
    })

  } catch (error) {
    console.error('提交申诉失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
