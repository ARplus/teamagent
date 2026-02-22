import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/agents/team — 获取司令官 + 主Agent + 子Agent们
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  try {
    // 查找当前用户
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: true }
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

    // === Commander（当前用户信息） ===
    const commander = {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      avatar: currentUser.avatar,
      createdAt: currentUser.createdAt,
    }

    // === 主 Agent（当前用户配对的 Agent） ===
    let mainAgent = null
    if (currentUser.agent) {
      const agent = currentUser.agent
      const doneSteps = await prisma.taskStep.count({
        where: { assigneeId: currentUser.id, status: 'done' }
      })
      const pendingSteps = await prisma.taskStep.count({
        where: {
          assigneeId: currentUser.id,
          status: { in: ['pending', 'in_progress', 'waiting_approval'] }
        }
      })
      mainAgent = {
        id: agent.id,
        name: agent.name,
        personality: agent.personality,
        avatar: agent.avatar,
        status: agent.status,
        capabilities: agent.capabilities,
        reputation: agent.reputation,
        claimedAt: agent.claimedAt,
        isMainAgent: true,
        stats: { doneSteps, pendingSteps }
      }
    }

    // === 子 Agent们（工作区内其他 Agent） ===
    let subAgents: object[] = []

    if (workspaceIds.length > 0) {
      // 找到工作区内有步骤的用户（不是自己）
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
        .filter((id): id is string => id !== null && id !== currentUser.id)

      if (assigneeIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          include: { agent: true }
        })

        subAgents = await Promise.all(
          users
            .filter(u => u.agent !== null)
            .map(async (u) => {
              const doneSteps = await prisma.taskStep.count({
                where: { assigneeId: u.id, status: 'done' }
              })
              const pendingSteps = await prisma.taskStep.count({
                where: {
                  assigneeId: u.id,
                  status: { in: ['pending', 'in_progress', 'waiting_approval'] }
                }
              })
              return {
                id: u.agent!.id,
                name: u.agent!.name,
                personality: u.agent!.personality,
                avatar: u.agent!.avatar,
                status: u.agent!.status,
                capabilities: u.agent!.capabilities,
                reputation: u.agent!.reputation,
                claimedAt: u.agent!.claimedAt,
                isMainAgent: false,
                userId: u.id,
                userName: u.name,
                userEmail: u.email,
                stats: { doneSteps, pendingSteps }
              }
            })
        )
      }
    }

    return NextResponse.json({ commander, mainAgent, subAgents })
  } catch (error) {
    console.error('获取战队 Agent 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
