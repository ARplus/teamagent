import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

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

    // 更新步骤状态
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'done',
        agentStatus: null,
        approvedAt: new Date(),
        approvedBy: user.id,
        completedAt: new Date()
      }
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
    }

    // 检查任务是否全部完成
    const remainingSteps = await prisma.taskStep.count({
      where: {
        taskId: step.taskId,
        status: { not: 'done' }
      }
    })

    if (remainingSteps === 0) {
      // 任务完成
      await prisma.task.update({
        where: { id: step.taskId },
        data: { status: 'done' }
      })
    }

    return NextResponse.json({
      message: '审核通过',
      step: updated,
      nextStep: nextStep ? {
        id: nextStep.id,
        title: nextStep.title,
        assigneeId: nextStep.assigneeId
      } : null,
      taskCompleted: remainingSteps === 0
    })

  } catch (error) {
    console.error('审核失败:', error)
    return NextResponse.json({ error: '审核失败' }, { status: 500 })
  }
}
