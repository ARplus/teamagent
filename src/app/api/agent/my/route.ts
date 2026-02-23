import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: true },
    })
    
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (!user.agent) {
      return NextResponse.json({ error: '未配对 Agent' }, { status: 404 })
    }

    return NextResponse.json({
      id: user.agent.id,
      name: user.agent.name,
      avatar: user.agent.avatar,
      status: user.agent.status,
      capabilities: user.agent.capabilities ? JSON.parse(user.agent.capabilities) : [],
    })
  } catch (error) {
    console.error('获取 Agent 失败:', error)
    return NextResponse.json({ error: '获取 Agent 失败' }, { status: 500 })
  }
}
