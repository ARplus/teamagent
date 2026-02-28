import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ADMIN_EMAILS = ['aurora@arplus.top']

// GET /api/admin/hierarchy — 三级层级视图：Human → Main Agent → Sub Agents
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 1. 获取所有用户及其主 Agent
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      nickname: true,
      email: true,
      avatar: true,
      createdAt: true,
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
          isMainAgent: true,
          capabilities: true,
          reputation: true,
          avatar: true,
          claimedAt: true,
          childAgents: {
            select: {
              id: true,
              name: true,
              status: true,
              isMainAgent: true,
              capabilities: true,
              reputation: true,
              avatar: true,
              userId: true,
              user: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      workspaces: {
        select: {
          role: true,
          workspace: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: {
          createdTasks: true,
          taskSteps: true,
        },
      },
    },
  })

  // 2. 获取任务统计（按工作区分组）
  const workspaceStats = await prisma.workspace.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
      tasks: {
        select: { status: true },
      },
    },
  })

  const wsOverview = workspaceStats.map(ws => {
    const total = ws.tasks.length
    const done = ws.tasks.filter(t => t.status === 'done').length
    const inProgress = ws.tasks.filter(t => t.status === 'in_progress').length
    const todo = ws.tasks.filter(t => t.status === 'todo' || t.status === 'suggested').length
    return {
      id: ws.id,
      name: ws.name,
      memberCount: ws._count.members,
      taskStats: { total, done, inProgress, todo },
    }
  })

  // 3. 构建层级树
  const hierarchy = users.map(u => {
    const mainAgent = u.agent
    const subAgents = mainAgent?.childAgents || []

    return {
      // Level 1: Human
      role: 'human' as const,
      id: u.id,
      name: u.name || u.nickname || u.email,
      email: u.email,
      avatar: u.avatar,
      createdAt: u.createdAt.toISOString(),
      workspaces: u.workspaces.map(w => ({ role: w.role, name: w.workspace.name, id: w.workspace.id })),
      stats: { tasks: u._count.createdTasks, steps: u._count.taskSteps },

      // Level 2: Main Agent (Commander)
      commander: mainAgent
        ? {
            role: 'commander' as const,
            id: mainAgent.id,
            name: mainAgent.name,
            status: mainAgent.status,
            avatar: mainAgent.avatar,
            capabilities: mainAgent.capabilities
              ? (() => { try { return JSON.parse(mainAgent.capabilities!) } catch { return [] } })()
              : [],
            reputation: mainAgent.reputation,
            claimedAt: mainAgent.claimedAt?.toISOString() || null,

            // Level 3: Sub Agents (Members)
            members: subAgents.map(sa => ({
              role: 'member' as const,
              id: sa.id,
              name: sa.name,
              status: sa.status,
              avatar: sa.avatar,
              capabilities: sa.capabilities
                ? (() => { try { return JSON.parse(sa.capabilities!) } catch { return [] } })()
                : [],
              reputation: sa.reputation,
              // 子 Agent 可能有独立的 userId（Agent-first 注册后被认领）
              linkedUser: sa.user ? { id: sa.user.id, name: sa.user.name } : null,
            })),
          }
        : null,
    }
  })

  // 4. 统计概要
  const summary = {
    totalHumans: users.length,
    totalCommanders: users.filter(u => u.agent).length,
    totalMembers: users.reduce((sum, u) => sum + (u.agent?.childAgents.length || 0), 0),
    unpairedHumans: users.filter(u => !u.agent).length,
  }

  return NextResponse.json({
    hierarchy,
    workspaceOverview: wsOverview,
    summary,
  })
}
