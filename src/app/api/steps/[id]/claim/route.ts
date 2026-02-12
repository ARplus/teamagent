import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// POST /api/steps/[id]/claim - Agent 领取步骤
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

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 检查是否是负责人
    if (step.assigneeId !== tokenAuth.user.id) {
      return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'pending') {
      return NextResponse.json({ error: '步骤已被领取或已完成' }, { status: 400 })
    }

    // 更新步骤状态
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
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

    return NextResponse.json({
      message: '已领取步骤',
      step: updated,
      context: {
        taskTitle: updated.task.title,
        taskDescription: updated.task.description,
        allSteps: updated.task.steps,
        currentStepOrder: updated.order
      }
    })

  } catch (error) {
    console.error('领取步骤失败:', error)
    return NextResponse.json({ error: '领取失败' }, { status: 500 })
  }
}
