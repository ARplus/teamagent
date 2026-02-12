import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// POST /api/steps/[id]/submit - Agent 提交结果等待审核
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

    const { result } = await req.json()

    const step = await prisma.taskStep.findUnique({
      where: { id }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 检查是否是负责人
    if (step.assigneeId !== tokenAuth.user.id) {
      return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'in_progress') {
      return NextResponse.json({ error: '步骤未在进行中' }, { status: 400 })
    }

    // 更新步骤状态
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'waiting_approval',
        agentStatus: 'waiting_approval',
        result: result || '任务已完成，等待审核'
      }
    })

    // 更新 Agent 状态
    await prisma.agent.update({
      where: { userId: tokenAuth.user.id },
      data: { status: 'online' }
    })

    return NextResponse.json({
      message: '已提交，等待人类审核',
      step: updated
    })

  } catch (error) {
    console.error('提交步骤失败:', error)
    return NextResponse.json({ error: '提交失败' }, { status: 500 })
  }
}
