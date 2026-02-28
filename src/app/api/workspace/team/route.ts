import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证（Session + Bearer Token）
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

// GET /api/workspace/team — 获取当前用户的完整协作网络
// 返回工作区内所有人类成员 + 他们的 Agent（分组展示）
// 用于：步骤分配下拉、任务拆解时的 availableTeam、工作区页面
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    // 找到用户的主工作区（作为 owner 的第一个工作区）
    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId, role: 'owner' },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' }
    })

    // 如果不是 owner，找用户所在的任意工作区
    if (!membership) {
      membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId },
        include: { workspace: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' }
      })
    }

    if (!membership) {
      return NextResponse.json({ error: '未找到工作区' }, { status: 404 })
    }

    const workspaceId = membership.workspace.id
    const workspaceName = membership.workspace.name

    // 获取工作区所有成员 + 他们的 Agent
    const allMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nickname: true,
            email: true,
            avatar: true,
            agent: {
              select: {
                id: true,
                name: true,
                isMainAgent: true,
                capabilities: true,
                status: true,
                avatar: true,
                personality: true,
                parentAgentId: true,
                parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } },
                childAgents: { select: { id: true, name: true, status: true, capabilities: true, userId: true, user: { select: { id: true, name: true } } } },
              }
            }
          }
        }
      },
      orderBy: { joinedAt: 'asc' }
    })

    // 组装返回数据：每个成员 = 人类 + 其 Agent
    const members = allMembers.map(m => {
      const user = m.user
      const agent = user.agent

      return {
        type: 'human' as const,
        id: user.id,
        name: user.name || user.email,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        isSelf: user.id === auth.userId,
        role: m.role, // owner / admin / member
        agent: agent ? {
          id: agent.id,
          name: agent.name,
          isMainAgent: agent.isMainAgent,
          capabilities: agent.capabilities ? JSON.parse(agent.capabilities) : [],
          status: agent.status,
          avatar: agent.avatar,
          personality: agent.personality,
          parentAgentId: agent.parentAgentId,
          parentAgent: agent.parentAgent ? { id: agent.parentAgent.id, name: agent.parentAgent.name, ownerName: agent.parentAgent.user?.name } : null,
          childAgents: (agent.childAgents || []).map((c: any) => ({
            id: c.id, name: c.name, status: c.status,
            capabilities: c.capabilities ? JSON.parse(c.capabilities) : [],
            ownerName: c.user?.name,
          })),
        } : null
      }
    })

    // 自己排在最前面
    members.sort((a, b) => {
      if (a.isSelf) return -1
      if (b.isSelf) return 1
      return 0
    })

    return NextResponse.json({
      workspaceId,
      workspaceName,
      members
    })

  } catch (error) {
    console.error('获取协作网络失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
