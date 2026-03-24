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

// 🔧 Agent 状态超时检查：超过 5 分钟无心跳视为离线
const AGENT_TIMEOUT_MS = 5 * 60 * 1000
function getEffectiveStatus(status: string, updatedAt: Date | null): string {
  if (updatedAt && (status === 'online' || status === 'working')) {
    const diff = Date.now() - new Date(updatedAt).getTime()
    if (diff > AGENT_TIMEOUT_MS) return 'offline'
  }
  return status
}

// 🔧 人类在线判断：最后心跳在 2 分钟内 = 在线
const HUMAN_ONLINE_MS = 2 * 60 * 1000
function isHumanOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < HUMAN_ONLINE_MS
}

// GET /api/workspace/team — 获取当前用户的完整协作网络
// 支持 ?workspaceId=xxx 指定工作区（频道页切换工作区时使用）
// 返回工作区内所有人类成员 + 他们的 Agent（分组展示）
// 用于：步骤分配下拉、任务拆解时的 availableTeam、工作区页面、频道成员列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const requestedWsId = req.nextUrl.searchParams.get('workspaceId')

    let workspaceId: string

    if (requestedWsId) {
      // 指定工作区：广场(plaza)允许任何认证用户，普通工作区需验证成员身份
      const ws = await prisma.workspace.findUnique({ where: { id: requestedWsId }, select: { id: true, type: true } })
      if (!ws) {
        return NextResponse.json({ error: '工作区不存在' }, { status: 404 })
      }
      if (ws.type !== 'plaza') {
        const isMember = await prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: auth.userId, workspaceId: requestedWsId } }
        })
        if (!isMember) {
          return NextResponse.json({ error: '无权访问此工作区' }, { status: 403 })
        }
      }
      workspaceId = requestedWsId
    } else {
      // 默认行为：找用户的主工作区
      let membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.userId, role: 'owner' },
        include: { workspace: { select: { id: true, name: true, type: true, orgType: true } } },
        orderBy: { joinedAt: 'asc' }
      })
      if (!membership) {
        membership = await prisma.workspaceMember.findFirst({
          where: { userId: auth.userId },
          include: { workspace: { select: { id: true, name: true, type: true, orgType: true } } },
          orderBy: { joinedAt: 'asc' }
        })
      }
      if (!membership) {
        return NextResponse.json({ error: '未找到工作区' }, { status: 404 })
      }
      workspaceId = membership.workspace.id
    }

    // 获取工作区信息
    const wsInfo = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, type: true, orgType: true }
    })
    if (!wsInfo) {
      return NextResponse.json({ error: '工作区不存在' }, { status: 404 })
    }
    const workspaceName = wsInfo.name
    const workspaceType = wsInfo.type || 'normal'
    const workspaceOrgType = wsInfo.orgType || null

    // 广场(plaza)：显示最近发过消息的用户 + 所有在线 Agent（而非 WorkspaceMember）
    if (workspaceType === 'plaza') {
      const recentSenders = await prisma.channelMessage.findMany({
        where: { channel: { workspaceId } },
        select: { senderId: true },
        distinct: ['senderId'],
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const senderIds = [...new Set(recentSenders.map(s => s.senderId))]
      // 也包含当前用户（即使没发过消息）
      if (!senderIds.includes(auth.userId)) senderIds.push(auth.userId)

      // 🌐 广场额外显示所有在线 Agent（即使没在广场发过消息，也可以被 @）
      const onlineAgents = await prisma.agent.findMany({
        where: { status: { in: ['online', 'working'] }, userId: { not: null }, parentAgentId: null },
        select: { userId: true },
      })
      for (const a of onlineAgents) {
        if (a.userId && !senderIds.includes(a.userId)) senderIds.push(a.userId)
      }

      const users = await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: {
          id: true, name: true, nickname: true, email: true, avatar: true, lastSeenAt: true,
          agent: {
            select: { id: true, name: true, isMainAgent: true, status: true, avatar: true, updatedAt: true, parentAgentId: true }
          }
        }
      })

      const members = users
        .filter(u => !u.agent?.parentAgentId) // 排除子 Agent 账号
        .map(u => ({
          type: 'human' as const,
          id: u.id,
          name: u.name || u.email,
          nickname: u.nickname,
          email: u.email,
          avatar: u.avatar,
          isSelf: u.id === auth.userId,
          isOnline: u.id === auth.userId || isHumanOnline(u.lastSeenAt),
          role: 'member',
          joinedAt: new Date(),
          agent: u.agent ? {
            id: u.agent.id, name: u.agent.name, isMainAgent: u.agent.isMainAgent,
            capabilities: [], status: getEffectiveStatus(u.agent.status, u.agent.updatedAt),
            avatar: u.agent.avatar, personality: null, parentAgentId: null, parentAgent: null, childAgents: [],
          } : null
        }))

      members.sort((a, b) => {
        if (a.isSelf) return -1
        if (b.isSelf) return 1
        return 0
      })

      return NextResponse.json({ workspaceId, workspaceName, workspaceType, workspaceOrgType, members })
    }

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
            lastSeenAt: true,
            agent: {
              select: {
                id: true,
                name: true,
                isMainAgent: true,
                capabilities: true,
                status: true,
                avatar: true,
                personality: true,
                updatedAt: true,
                parentAgentId: true,
                parentAgent: { select: { id: true, name: true, user: { select: { id: true, name: true } } } },
                childAgents: { select: { id: true, name: true, status: true, updatedAt: true, capabilities: true, userId: true, user: { select: { id: true, name: true } } } },
              }
            }
          }
        }
      },
      orderBy: { joinedAt: 'asc' }
    })

    // 组装返回数据：每个成员 = 人类 + 其 Agent
    // 过滤掉子 Agent 的用户账号（parentAgentId 不为空 = 子 Agent，不是真正的人类用户）
    const humanMembers = allMembers.filter(m => {
      const agent = m.user.agent
      // 没有 agent → 纯人类，保留
      if (!agent) return true
      // 有 agent 但没有 parentAgentId → 主 Agent 的人类主人，保留
      if (!agent.parentAgentId) return true
      // 有 parentAgentId → 这是子 Agent 的用户账号，过滤掉
      return false
    })

    const members = humanMembers.map(m => {
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
        isOnline: user.id === auth.userId || isHumanOnline(user.lastSeenAt),
        role: m.role, // owner / admin / member
        joinedAt: m.joinedAt,
        agent: agent ? {
          id: agent.id,
          name: agent.name,
          isMainAgent: agent.isMainAgent,
          capabilities: agent.capabilities ? JSON.parse(agent.capabilities) : [],
          status: getEffectiveStatus(agent.status, agent.updatedAt),
          avatar: agent.avatar,
          personality: agent.personality,
          parentAgentId: agent.parentAgentId,
          parentAgent: agent.parentAgent ? { id: agent.parentAgent.id, name: agent.parentAgent.name, ownerName: agent.parentAgent.user?.name } : null,
          childAgents: (agent.childAgents || []).map((c: any) => ({
            id: c.id, name: c.name,
            status: getEffectiveStatus(c.status, c.updatedAt),
            capabilities: c.capabilities ? JSON.parse(c.capabilities) : [],
            userId: c.userId,
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
      workspaceType,
      workspaceOrgType,
      members
    })

  } catch (error) {
    console.error('获取协作网络失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
