import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

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
        soul: agent.soul,              // 🆕 军团成长
        growthXP: agent.growthXP,      // 🆕
        growthLevel: agent.growthLevel, // 🆕
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

// PATCH /api/agents/[id] — 主 Agent 更新子 Agent 档案（name/soul/capabilities/personality）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 双重认证：Token（Agent CLI）或 Session（Web）
  let userId: string | null = null
  const authResult = await authenticateRequest(req)
  if (authResult) {
    userId = authResult.user.id
  } else {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email } })
      userId = u?.id ?? null
    }
  }
  if (!userId) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  try {
    const { id: targetAgentId } = await params
    const body = await req.json()

    // 查调用者的主 Agent
    const caller = await prisma.user.findUnique({
      where: { id: userId },
      include: { agent: true }
    })
    if (!caller?.agent) {
      return NextResponse.json({ error: '你没有关联的 Agent' }, { status: 403 })
    }

    // 查目标 Agent
    const targetAgent = await prisma.agent.findUnique({
      where: { id: targetAgentId }
    })
    if (!targetAgent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }

    // 权限检查：自己的子 Agent 或自己
    const isSelf = targetAgent.id === caller.agent.id
    const isParent = targetAgent.parentAgentId === caller.agent.id
    if (!isSelf && !isParent) {
      return NextResponse.json({ error: '只能更新自己或自己的子 Agent' }, { status: 403 })
    }

    // 构建更新数据
    const agentUpdate: Record<string, any> = {}
    const userUpdate: Record<string, any> = {}

    if (typeof body.name === 'string' && body.name.trim()) {
      agentUpdate.name = body.name.trim()
      userUpdate.name = body.name.trim()  // 同步 User.name
    }
    if (typeof body.soul === 'string') {
      agentUpdate.soul = body.soul
    }
    if (typeof body.personality === 'string') {
      agentUpdate.personality = body.personality
    }
    if (Array.isArray(body.capabilities)) {
      agentUpdate.capabilities = JSON.stringify(body.capabilities)
    }

    if (Object.keys(agentUpdate).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }

    // 事务更新 Agent + User.name
    const updated = await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.update({
        where: { id: targetAgentId },
        data: agentUpdate,
      })
      if (Object.keys(userUpdate).length > 0 && targetAgent.userId) {
        await tx.user.update({
          where: { id: targetAgent.userId },
          data: userUpdate,
        })
      }
      return agent
    })

    return NextResponse.json({
      success: true,
      agent: {
        id: updated.id,
        name: updated.name,
        soul: updated.soul,
        personality: updated.personality,
        capabilities: updated.capabilities,
      }
    })
  } catch (error) {
    console.error('更新 Agent 档案失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// DELETE /api/agents/[id] — 删除子 Agent（只能删除自己的子 Agent）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  const { id: targetAgentId } = await params

  try {
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: { select: { id: true } } }
    })
    if (!currentUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    // 查目标 agent，验证是当前用户的子 Agent
    const targetAgent = await prisma.agent.findUnique({
      where: { id: targetAgentId },
      include: { user: { select: { id: true } } }
    })
    if (!targetAgent) return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    if (targetAgent.parentAgentId !== currentUser.agent?.id) {
      return NextResponse.json({ error: '只能删除自己的子 Agent' }, { status: 403 })
    }

    const subUserId = targetAgent.userId

    // 事务删除：apiToken → workspaceMember → agent → user
    await prisma.$transaction(async (tx) => {
      if (subUserId) {
        await tx.apiToken.deleteMany({ where: { userId: subUserId } })
        await tx.workspaceMember.deleteMany({ where: { userId: subUserId } })
        await tx.stepAssignee.deleteMany({ where: { userId: subUserId } })
      }
      await tx.agent.delete({ where: { id: targetAgentId } })
      if (subUserId) {
        await tx.user.delete({ where: { id: subUserId } })
      }
    })

    console.log(`[Agent/Delete] ✅ 子 Agent ${targetAgentId} 已删除`)
    return NextResponse.json({ success: true, message: '子 Agent 已删除' })
  } catch (error) {
    console.error('删除子 Agent 失败:', error)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
