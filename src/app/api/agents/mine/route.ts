import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * GET /api/agents/mine
 *
 * 返回当前调用者（人类或 Agent）的主 Agent 信息。
 * 支持 Bearer token 和 session cookie 两种认证方式。
 *
 * Response:
 * {
 *   id, name, avatar, status, capabilities,
 *   userId,          // 所属人类 userId
 *   isMainAgent,
 *   personality,
 *   soul
 * }
 */

async function authenticate(req: NextRequest): Promise<string | null> {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return tokenAuth.user.id

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    return u?.id ?? null
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const userId = await authenticate(req)
    if (!userId) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const agent = await prisma.agent.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        avatar: true,
        status: true,
        capabilities: true,
        personality: true,
        soul: true,
        isMainAgent: true,
        userId: true,
        updatedAt: true,
      },
    })

    if (!agent) {
      return NextResponse.json({ error: '未找到 Agent，请先完成配对' }, { status: 404 })
    }

    // 超过 5 分钟无活动视为离线
    let effectiveStatus = agent.status
    if (agent.updatedAt && (agent.status === 'online' || agent.status === 'working')) {
      const diff = Date.now() - new Date(agent.updatedAt).getTime()
      if (diff > 5 * 60 * 1000) {
        effectiveStatus = 'offline'
        prisma.agent.update({ where: { id: agent.id }, data: { status: 'offline' } }).catch(() => {})
      }
    }

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      status: effectiveStatus,
      capabilities: agent.capabilities ? JSON.parse(agent.capabilities) : [],
      personality: agent.personality,
      soul: agent.soul,
      isMainAgent: agent.isMainAgent,
      userId: agent.userId,
    })
  } catch (error) {
    console.error('[agents/mine] 失败:', error)
    return NextResponse.json({ error: '获取 Agent 信息失败' }, { status: 500 })
  }
}
