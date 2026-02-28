import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, type TeamAgentEvent } from '@/lib/events'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id }
  }
  return null
}

// POST /api/agent-calls/[id]/respond — 人类回应 Agent 呼叫
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: callId } = await params
    const body = await req.json()
    const { action, message } = body as { action: 'accept' | 'decline'; message?: string }

    if (!action || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: '无效的 action，必须是 accept 或 decline' }, { status: 400 })
    }

    // 查找呼叫通知
    const call = await prisma.notification.findUnique({
      where: { id: callId },
      include: {
        task: { select: { id: true, title: true } },
        step: { select: { id: true, title: true } },
      },
    })

    if (!call) return NextResponse.json({ error: '呼叫不存在' }, { status: 404 })
    if (call.type !== 'agent_call') return NextResponse.json({ error: '不是一个呼叫通知' }, { status: 400 })
    if (call.userId !== auth.userId) return NextResponse.json({ error: '无权回应此呼叫' }, { status: 403 })
    if (call.callStatus !== 'pending') {
      return NextResponse.json({ error: `呼叫已被处理: ${call.callStatus}` }, { status: 409 })
    }

    // 更新呼叫状态
    const newStatus = action === 'accept' ? 'accepted' : 'declined'
    await prisma.notification.update({
      where: { id: callId },
      data: {
        callStatus: newStatus,
        respondedAt: new Date(),
        read: true,
        content: message ? `${call.content || ''}\n\n回复: ${message}` : call.content,
      },
    })

    // 通知 Agent（通过 SSE 发给 Agent 的 userId）
    // 找到发起呼叫的 Agent（通过任务/步骤关联或直接找用户的 Agent）
    // 简单处理：查找目标用户的 Agent
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true, agent: { select: { userId: true } } },
    })

    // 如果 Agent 有 userId，可以发 SSE 通知
    if (user?.agent?.userId) {
      sendToUser(user.agent.userId, {
        type: 'agent:call-responded',
        callId,
        action: newStatus,
        message: message || undefined,
        respondedBy: user.name || auth.userId,
      } as TeamAgentEvent)
    }

    return NextResponse.json({
      success: true,
      callId,
      status: newStatus,
    })
  } catch (error) {
    console.error('回应 Agent 呼叫失败:', error)
    return NextResponse.json({ error: '回应呼叫失败' }, { status: 500 })
  }
}
