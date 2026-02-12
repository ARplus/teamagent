import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

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

    // 检查权限
    if (step.task.creatorId !== user.id && step.assigneeId !== user.id) {
      return NextResponse.json({ error: '无权审核此步骤' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'waiting_approval') {
      return NextResponse.json({ error: '步骤未在等待审核状态' }, { status: 400 })
    }

    // 更新步骤状态 - 打回修改
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'in_progress', // 打回重做
        agentStatus: 'pending', // Agent 需要重新领取
        rejectedAt: new Date(),
        rejectionReason: reason || '需要修改'
      }
    })

    return NextResponse.json({
      message: '已打回修改',
      step: updated
    })

  } catch (error) {
    console.error('拒绝失败:', error)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
