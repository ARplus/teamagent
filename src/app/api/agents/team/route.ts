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

    // === 子 Agent们（工作区内所有成员，不含自己） ===
    let subAgents: object[] = []

    if (workspaceIds.length > 0) {
      // 取工作区内所有成员（不含自己）
      const teamMemberships = await prisma.workspaceMember.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          userId: { not: currentUser.id }
        },
        include: {
          user: { include: { agent: true } }
        }
      })

      const members = teamMemberships
        .map(m => m.user)
        .filter(u => u.agent !== null)

      subAgents = await Promise.all(
        members.map(async (u) => {
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
