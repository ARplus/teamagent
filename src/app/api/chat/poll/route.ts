// GET /api/chat/poll?msgId=xxx
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

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

  // ============ 30 秒超时：不再 LLM 兜底，直接离线提示 ============

  // 原子抢占：只有第一个 poll 请求能写入离线提示
  const claimed = await prisma.chatMessage.updateMany({
    where: { id: msgId, content: '__pending__' },
    data: { content: '__offline__' },
  })
  if (claimed.count === 0) {
    // 被别的 poll 抢先了，重新查一次
    const refreshed = await prisma.chatMessage.findUnique({ where: { id: msgId } })
    if (refreshed && refreshed.content !== '__offline__') {
      return NextResponse.json({
        ready: true,
        message: { id: refreshed.id, content: refreshed.content, role: refreshed.role, createdAt: refreshed.createdAt },
      })
    }
    return NextResponse.json({ ready: false })
  }

  // 取 Agent 名字
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { agent: { select: { name: true } } },
  })
  const agentName = user?.agent?.name ?? 'Agent'

  const offlineMsg = `📵 ${agentName} 暂未回复（已超 30 秒）。可点右上角 📞 三联呼叫Ta！`
  await prisma.chatMessage.update({ where: { id: msgId }, data: { content: offlineMsg } })

  console.log(`[chat/poll] ⏱ Agent 超时 ${Math.round(elapsed / 1000)}s，写入离线提示 (msgId=${msgId})`)

  return NextResponse.json({
    ready: true,
    message: { id: msgId, content: offlineMsg, role: msg.role, createdAt: msg.createdAt },
  })
}
