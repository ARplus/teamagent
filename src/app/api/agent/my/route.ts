import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

// 统一认证：支持 agent token 和 session
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
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { agent: true },
    })

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (!user.agent) {
      return NextResponse.json({ error: '未配对 Agent' }, { status: 404 })
    }

    // 根据 updatedAt 判断真实状态：超过 5 分钟无活动视为离线
    let effectiveStatus = user.agent.status
    if (user.agent.updatedAt && (user.agent.status === 'online' || user.agent.status === 'working')) {
      const diff = Date.now() - new Date(user.agent.updatedAt).getTime()
      if (diff > 5 * 60 * 1000) {
        effectiveStatus = 'offline'
        prisma.agent.update({ where: { id: user.agent.id }, data: { status: 'offline' } }).catch(() => {})
      }
    }

    // 查 Agent 的 API Token
    const agentToken = await prisma.apiToken.findFirst({
      where: { userId: user.agent.userId as string },
      select: { displayToken: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      id: user.agent.id,
      name: user.agent.name,
      avatar: user.agent.avatar,
      status: effectiveStatus,
      capabilities: user.agent.capabilities ? JSON.parse(user.agent.capabilities) : [],
      agentToken: agentToken?.displayToken ?? null,
      agentTokenName: agentToken?.name ?? null,
    })
  } catch (error) {
    console.error('获取 Agent 失败:', error)
    return NextResponse.json({ error: '获取 Agent 失败' }, { status: 500 })
  }
}
