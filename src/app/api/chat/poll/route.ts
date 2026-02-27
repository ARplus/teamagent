// GET /api/chat/poll?msgId=xxx
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserContext, buildSystemPrompt, callLLM, executeAction } from '@/lib/chat-llm'

// Agent 未回复的超时阈值（毫秒）
const AGENT_REPLY_TIMEOUT_MS = 30_000

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const msgId = req.nextUrl.searchParams.get('msgId')
  if (!msgId) return NextResponse.json({ error: '缺少 msgId' }, { status: 400 })

  const msg = await prisma.chatMessage.findUnique({ where: { id: msgId } })
  if (!msg) return NextResponse.json({ error: '消息不存在' }, { status: 404 })

  // Agent 已回复
  if (msg.content !== '__pending__' && msg.content !== '__fallback_in_progress__') {
    return NextResponse.json({
      ready: true,
      message: {
        id: msg.id,
        content: msg.content,
        role: msg.role,
        createdAt: msg.createdAt,
      },
    })
  }

  // 还在等 Agent 回复 — 检查是否超时
  const elapsed = Date.now() - msg.createdAt.getTime()
  if (elapsed < AGENT_REPLY_TIMEOUT_MS) {
    return NextResponse.json({ ready: false })
  }

  // ============ 30 秒超时，触发 LLM 兜底 ============

  // 原子抢占：只有第一个 poll 请求能触发 fallback
  const claimed = await prisma.chatMessage.updateMany({
    where: { id: msgId, content: '__pending__' },
    data: { content: '__fallback_in_progress__' },
  })
  if (claimed.count === 0) {
    // 被别的 poll 抢先了，或 Agent 刚回复了 — 重新查一次
    const refreshed = await prisma.chatMessage.findUnique({ where: { id: msgId } })
    if (refreshed && refreshed.content !== '__fallback_in_progress__') {
      return NextResponse.json({
        ready: true,
        message: {
          id: refreshed.id,
          content: refreshed.content,
          role: refreshed.role,
          createdAt: refreshed.createdAt,
        },
      })
    }
    // 另一个请求正在处理 fallback，继续等
    return NextResponse.json({ ready: false })
  }

  // 我们抢到了 fallback 权，开始调用 LLM
  console.log(`[chat/poll] ⏱ Agent 超时 ${Math.round(elapsed / 1000)}s，触发 LLM 兜底 (msgId=${msgId})`)

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: true },
    })
    if (!user) {
      await prisma.chatMessage.update({ where: { id: msgId }, data: { content: '系统错误，请重试。' } })
      return NextResponse.json({ ready: true, message: { id: msgId, content: '系统错误，请重试。', role: 'agent', createdAt: msg.createdAt } })
    }

    const agentName = user.agent?.name || 'AI 助手'
    const userName = user.name || user.email?.split('@')[0] || '用户'

    // 找到触发这条 pending 消息的用户原始消息
    const userMsg = await prisma.chatMessage.findFirst({
      where: { userId: user.id, role: 'user', createdAt: { lte: msg.createdAt } },
      orderBy: { createdAt: 'desc' },
    })

    if (!userMsg) {
      await prisma.chatMessage.update({ where: { id: msgId }, data: { content: '抱歉，没找到你的消息，请重新发送。' } })
      return NextResponse.json({ ready: true, message: { id: msgId, content: '抱歉，没找到你的消息，请重新发送。', role: 'agent', createdAt: msg.createdAt } })
    }

    // 拉上下文 + 历史
    const ctx = await getUserContext(user.id, agentName, userName)
    const recentMessages = await prisma.chatMessage.findMany({
      where: { userId: user.id, createdAt: { lt: msg.createdAt } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const history = recentMessages.reverse().map(m => ({ role: m.role, content: m.content }))

    const systemPrompt = buildSystemPrompt(ctx)
    let reply = await callLLM(systemPrompt, userMsg.content, history)

    // 解析并执行 Action
    const actionMatch = reply.match(/@@ACTION@@([\s\S]*?)@@END@@/)
    if (actionMatch) {
      const actionResult = await executeAction(actionMatch[1].trim(), user.id, null)
      reply = reply.replace(/@@ACTION@@[\s\S]*?@@END@@/, '').trim() + actionResult
    }

    // 更新消息内容
    await prisma.chatMessage.update({
      where: { id: msgId },
      data: { content: reply },
    })

    console.log(`[chat/poll] ✅ LLM 兜底回复已写入 (msgId=${msgId})`)

    return NextResponse.json({
      ready: true,
      message: {
        id: msgId,
        content: reply,
        role: msg.role,
        createdAt: msg.createdAt,
      },
    })
  } catch (error) {
    console.error('[chat/poll] LLM 兜底失败:', error)
    const fallbackMsg = '⏱ Agent 暂时不在线，请稍后再试。'
    await prisma.chatMessage.update({ where: { id: msgId }, data: { content: fallbackMsg } }).catch(() => {})
    return NextResponse.json({
      ready: true,
      message: { id: msgId, content: fallbackMsg, role: msg.role, createdAt: msg.createdAt },
    })
  }
}
