import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/agents/team — 获取当前用户工作区的所有 Agent
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  try {
    // 查找当前用户
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (!currentUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 找到用户所在的所有工作区
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: currentUser.id },
      select: { workspaceId: true }
    })
    const workspaceIds = memberships.map(m => m.workspaceId)

    if (workspaceIds.length === 0) {
      return NextResponse.json({ agents: [] })
    }

    // 找到这些工作区的所有任务里出现过的 assigneeId
    const steps = await prisma.taskStep.findMany({
      where: {
        assigneeId: { not: null },
        task: { workspaceId: { in: workspaceIds } }
      },
      select: { assigneeId: true },
      distinct: ['assigneeId']
    })

    const assigneeIds = steps
      .map(s => s.assigneeId)
      .filter((id): id is string => id !== null)

    // 合并当前用户自己（如果还没有步骤也要显示）
    if (!assigneeIds.includes(currentUser.id)) {
      assigneeIds.push(currentUser.id)
    }

    // 批量查询这些用户及其 Agent
    const users = await prisma.user.findMany({
      where: { id: { in: assigneeIds } },
      include: {
        agent: true
      }
    })

    // 对每个用户查询简单 stats
    const result = await Promise.all(
      users
        .filter(u => u.agent !== null)  // 只返回有 Agent 的用户
        .map(async (u) => {
          const agentUser = u

          const doneSteps = await prisma.taskStep.count({
            where: { assigneeId: agentUser.id, status: 'done' }
          })

          const pendingSteps = await prisma.taskStep.count({
            where: {
              assigneeId: agentUser.id,
              status: { in: ['pending', 'in_progress', 'waiting_approval'] }
            }
          })

          return {
            agent: {
              id: agentUser.agent!.id,
              name: agentUser.agent!.name,
              personality: agentUser.agent!.personality,
              avatar: agentUser.agent!.avatar,
              status: agentUser.agent!.status,
              capabilities: agentUser.agent!.capabilities,
              reputation: agentUser.agent!.reputation,
              claimedAt: agentUser.agent!.claimedAt,
            },
            user: {
              id: agentUser.id,
              name: agentUser.name,
              email: agentUser.email,
            },
            stats: {
              doneSteps,
              pendingSteps,
            },
            isCurrentUser: agentUser.id === currentUser.id,
          }
        })
    )

    return NextResponse.json({ agents: result })
  } catch (error) {
    console.error('获取战队 Agent 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
