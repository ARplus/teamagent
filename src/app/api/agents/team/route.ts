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
      nickname: currentUser.nickname,
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
        soul: agent.soul,              // 🆕 军团成长
        growthXP: agent.growthXP,      // 🆕
        growthLevel: agent.growthLevel, // 🆕
        stats: { doneSteps, pendingSteps }
      }
    }

    // === 子 Agent们（仅当前主 Agent 直属子 Agent） ===
    let subAgents: object[] = []

    if (currentUser.agent) {
      const childAgents = await prisma.agent.findMany({
        where: {
          parentAgentId: currentUser.agent.id,
          userId: { not: currentUser.id }
        },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      })

      subAgents = await Promise.all(
        childAgents.map(async (a) => {
          const doneSteps = await prisma.taskStep.count({
            where: { assigneeId: a.userId, status: 'done' }
          })
          const pendingSteps = await prisma.taskStep.count({
            where: {
              assigneeId: a.userId,
              status: { in: ['pending', 'in_progress', 'waiting_approval'] }
            }
          })

          return {
            id: a.id,
            name: a.name,
            personality: a.personality,
            avatar: a.avatar,
            status: a.status,
            capabilities: a.capabilities,
            reputation: a.reputation,
            claimedAt: a.claimedAt,
            isMainAgent: false,
            userId: a.user!.id,
            userName: a.user!.name,
            userEmail: a.user!.email,
            soul: a.soul,              // 🆕 军团成长
            growthXP: a.growthXP,      // 🆕
            growthLevel: a.growthLevel, // 🆕
            stats: { doneSteps, pendingSteps }
          }
        })
      )
    }

    // === 任务统计 ===
    let taskStats = {
      inProgressTasks: 0,
      doneTasks: 0,
      soloTasks: 0,       // 内部（solo mode）
      teamTasks: 0,       // 外部（team mode）
      totalAgentMs: 0,
      totalHumanMs: 0,
    }

    if (workspaceIds.length > 0) {
      const [inProgress, done, tasks] = await Promise.all([
        prisma.task.count({
          where: { workspaceId: { in: workspaceIds }, status: { in: ['todo', 'in_progress'] } }
        }),
        prisma.task.count({
          where: { workspaceId: { in: workspaceIds }, status: 'done' }
        }),
        prisma.task.findMany({
          where: { workspaceId: { in: workspaceIds } },
          select: { mode: true, totalAgentTimeMs: true, totalHumanTimeMs: true }
        })
      ])

      taskStats.inProgressTasks = inProgress
      taskStats.doneTasks = done
      taskStats.soloTasks = tasks.filter(t => t.mode === 'solo').length
      taskStats.teamTasks = tasks.filter(t => t.mode === 'team').length
      taskStats.totalAgentMs = tasks.reduce((s, t) => s + (t.totalAgentTimeMs || 0), 0)
      taskStats.totalHumanMs = tasks.reduce((s, t) => s + (t.totalHumanTimeMs || 0), 0)
    }

    return NextResponse.json({ commander, mainAgent, subAgents, taskStats })
  } catch (error) {
    console.error('获取战队 Agent 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
