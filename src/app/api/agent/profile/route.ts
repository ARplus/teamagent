import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证（和 status 路由保持一致）
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }

  return null
}

// GET /api/agent/profile - 获取当前用户的 Agent 档案 + 战绩统计
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)

    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 查询 Agent
    const agent = await prisma.agent.findUnique({
      where: { userId: auth.userId },
      include: { user: { select: { id: true, name: true, email: true } } }
    })

    if (!agent) {
      return NextResponse.json({ agent: null, stats: null })
    }

    // 查询战绩统计（通过 TaskStep.assigneeId = user.id）
    const userId = auth.userId

    // 已完成步骤数
    const totalSteps = await prisma.taskStep.count({
      where: { assigneeId: userId, status: 'done' }
    })

    // 进行中步骤数
    const pendingSteps = await prisma.taskStep.count({
      where: {
        assigneeId: userId,
        status: { in: ['pending', 'in_progress', 'waiting_approval'] }
      }
    })

    // 被打回总次数（rejectionCount 字段求和）
    const rejectionResult = await prisma.taskStep.aggregate({
      where: { assigneeId: userId },
      _sum: { rejectionCount: true }
    })
    const rejectedCount = rejectionResult._sum.rejectionCount ?? 0

    // 申诉成功次数
    const appealWonCount = await prisma.taskStep.count({
      where: { assigneeId: userId, appealStatus: 'upheld' }
    })

    // 平均耗时（只统计有 agentDurationMs 值的步骤）
    const durationResult = await prisma.taskStep.aggregate({
      where: { assigneeId: userId, agentDurationMs: { not: null } },
      _avg: { agentDurationMs: true },
      _count: { agentDurationMs: true }
    })
    const avgDurationMs = durationResult._avg.agentDurationMs ?? null

    // 最近 5 条步骤（done / rejected / waiting_approval）
    const recentSteps = await prisma.taskStep.findMany({
      where: {
        assigneeId: userId,
        status: { in: ['done', 'rejected', 'waiting_approval'] }
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
        pairingCode: agent.pairingCode,
        user: agent.user
      },
      stats: {
        totalSteps,
        pendingSteps,
        rejectedCount,
        appealWonCount,
        avgDurationMs
      },
      recentSteps: recentSteps.map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        updatedAt: s.updatedAt,
        completedAt: s.completedAt,
        task: s.task
      }))
    })
  } catch (error) {
    console.error('获取 Agent 档案失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// PATCH /api/agent/profile - 更新当前用户的 Agent 信息（名字、性格描述）
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } })
    if (!agent) return NextResponse.json({ error: '你还没有 Agent' }, { status: 404 })

    const body = await req.json()
    const { name, personality, capabilities } = body

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json({ error: '名字不能为空' }, { status: 400 })
    }

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(personality !== undefined && { personality: personality.trim() || null }),
        ...(capabilities !== undefined && { capabilities: JSON.stringify(capabilities) }),
      }
    })

    return NextResponse.json({ ok: true, agent: { id: updated.id, name: updated.name, personality: updated.personality } })
  } catch (error) {
    console.error('更新 Agent 档案失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
