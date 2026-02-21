import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/agents — 获取所有已注册的 Agent 列表（用于步骤分配下拉选）
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const agents = await prisma.agent.findMany({
    where: { status: { not: 'offline' }, userId: { not: null } },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  return NextResponse.json({
    agents: agents
      .filter(a => a.user && a.userId)
      .map(a => ({
        agentId: a.id,
        userId: a.userId!,
        name: a.name || a.user?.name || a.user?.email || 'Agent',
        email: a.user?.email || '',
        capabilities: a.capabilities ? JSON.parse(a.capabilities) : [],
        status: a.status,
        avatar: a.user?.avatar || null,
      }))
  })
}
