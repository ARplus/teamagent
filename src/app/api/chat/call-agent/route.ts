import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

/**
 * POST /api/chat/call-agent
 * 三联呼：向 Agent 的 OpenClaw SSE 连接发送 agent:calling 事件
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { agent: { select: { id: true, name: true } } },
  })

  if (!user?.agent) {
    return NextResponse.json({ error: '未配对 Agent' }, { status: 404 })
  }

  // 向 Agent 发 calling 事件（Agent 的 OpenClaw 订阅在 user.id 下）
  sendToUser(user.id, {
    type: 'agent:calling',
    callId: `call-${Date.now()}`,
    priority: 'urgent',
    title: '📞 三联呼',
    content: `${user.name || '用户'} 正在呼叫你，请立即回复！`,
    agentName: user.agent.name,
  })

  return NextResponse.json({ ok: true, agentName: user.agent.name })
}
