import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/agents/[id] — 获取任意 Agent 的档案 + 战绩统计
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  try {
    const { id: agentId } = await params

    // 查找当前用户
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (!currentUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 查找 Agent
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }

    if (!agent.userId) {
      return NextResponse.json({ error: 'Agent 尚未认领' }, { status: 404 })
    }

    const userId = agent.userId

    // 战绩统计
    const totalSteps = await prisma.taskStep.count({
      where: { assigneeId: userId, status: 'done' }
    })

    const pendingSteps = await prisma.taskStep.count({
      where: {
        assigneeId: userId,
        status: { in: ['pending', 'in_progress', 'waiting_approval'] }
      }
    })

    const rejectionResult = await prisma.taskStep.aggregate({
      where: { assigneeId: userId },
      _sum: { rejectionCount: true }
    })
    const rejectedCount = rejectionResult._sum.rejectionCount ?? 0

    const appealWonCount = await prisma.taskStep.count({
      where: { assigneeId: userId, appealStatus: 'upheld' }
    })

    const durationResult = await prisma.taskStep.aggregate({
      where: { assigneeId: userId, agentDurationMs: { not: null } },
      _avg: { agentDurationMs: true }
    })
    const avgDurationMs = durationResult._avg.agentDurationMs ?? null

    // 最近 5 条步骤
    const recentSteps = await prisma.taskStep.findMany({
      where: {
        assigneeId: userId,
        status: { in: ['done', 'rejected', 'waiting_approval', 'in_progress'] }
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        task: { select: { id: true, title: true } }
      }
    })

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        personality: agent.personality,
        avatar: agent.avatar,
        status: agent.status,
        capabilities: agent.capabilities,
        reputation: agent.reputation,
        claimedAt: agent.claimedAt,
        user: agent.user,
      },
      stats: {
        totalSteps,
        pendingSteps,
        rejectedCount,
        appealWonCount,
        avgDurationMs,
      },
      recentSteps: recentSteps.map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        updatedAt: s.updatedAt,
        completedAt: s.completedAt,
        task: s.task,
      })),
      isOwner: agent.userId === currentUser.id,
    })
  } catch (error) {
    console.error('获取 Agent 档案失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
