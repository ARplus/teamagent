import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { addSubscriber, removeSubscriber, startHeartbeat, startScheduledTicker } from '@/lib/events'

// 统一认证
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

/**
 * GET /api/agent/subscribe
 * 
 * SSE 端点，Agent 订阅实时事件
 * 
 * 使用方式（客户端）:
 * ```javascript
 * const eventSource = new EventSource('/api/agent/subscribe', {
 *   headers: { 'Authorization': 'Bearer ta_xxx' }
 * })
 * 
 * eventSource.onmessage = (event) => {
 *   const data = JSON.parse(event.data)
 *   console.log('收到事件:', data)
 * }
 * ```
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  
  if (!auth) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 获取用户的 Agent（可能没有，Agent-First 模式下用户先注册后认领）
  const agent = await prisma.agent.findUnique({
    where: { userId: auth.userId }
  })

  // 没有 Agent 也允许连接，返回等待状态
  if (!agent) {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const msg = `data: ${JSON.stringify({
          type: 'connected',
          agentId: null,
          agentName: null,
          message: '🔗 已连接，等待认领 Agent'
        })}\n\n`
        controller.enqueue(encoder.encode(msg))
        // 保持连接但不订阅事件
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }

  // 更新 Agent 状态为在线
  await prisma.agent.update({
    where: { id: agent.id },
    data: { status: 'online' }
  })

  // 确保心跳已启动
  startHeartbeat()
  // 确保定时任务调度器已启动
  startScheduledTicker()

  // 断点续传：读取 Last-Event-ID 或 since 参数
  const lastEventId = req.headers.get('last-event-id') || req.nextUrl.searchParams.get('since')
  const sinceDate = lastEventId ? new Date(lastEventId) : null

  // 预查断连期间漏掉的 chat:incoming：找还是 __pending__ 的 agent 消息
  // 并关联上前一条 user 消息内容
  interface MissedMsg { agentMsgId: string; content: string; createdAt: Date }
  let missedMessages: MissedMsg[] = []
  if (sinceDate && !isNaN(sinceDate.getTime())) {
    const pendingAgentMsgs = await prisma.chatMessage.findMany({
      where: { userId: auth.userId, role: 'agent', content: '__pending__', createdAt: { gt: sinceDate } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, createdAt: true }
    })
    for (const pm of pendingAgentMsgs) {
      // 找同一毫秒前后的 user 消息
      const userMsg = await prisma.chatMessage.findFirst({
        where: { userId: auth.userId, role: 'user', createdAt: { lte: pm.createdAt } },
        orderBy: { createdAt: 'desc' },
        select: { content: true }
      })
      missedMessages.push({ agentMsgId: pm.id, content: userMsg?.content || '', createdAt: pm.createdAt })
    }
  }
  // 无 since 时不主动补发历史消息，避免每次连接都轰炸

  // 创建 SSE 流
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      
      // 发送连接成功消息
      const welcomeMsg = `data: ${JSON.stringify({
        type: 'connected',
        agentId: agent.id,
        agentName: agent.name,
        message: '🦞 已连接到 TeamAgent'
      })}\n\n`
      controller.enqueue(encoder.encode(welcomeMsg))

      // 补发断连期间漏掉的消息（chat:incoming，agentMsgId 就是占位消息 id）
      for (const m of missedMessages) {
        const catchupMsg = `data: ${JSON.stringify({
          type: 'chat:incoming',
          msgId: m.agentMsgId,
          content: m.content,
          senderName: '用户',
          catchup: true
        })}\n\n`
        controller.enqueue(encoder.encode(catchupMsg))
      }

      // 注册订阅者
      const subscriberId = addSubscriber(auth.userId, agent.id, controller)

      // 当连接关闭时清理
      req.signal.addEventListener('abort', () => {
        removeSubscriber(subscriberId)
        
        // 更新 Agent 状态为离线（异步，不阻塞）
        prisma.agent.update({
          where: { id: agent.id },
          data: { status: 'offline' }
        }).catch(console.error)
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // 禁用 nginx 缓冲
    }
  })
}
