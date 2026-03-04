// POST /api/chat/reply
// Bearer <agent-token>
// { msgId: string, content: string }
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

  const { msgId, content } = await req.json()
  if (!msgId || !content) return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  const msg = await prisma.chatMessage.findUnique({ where: { id: msgId } })
  if (!msg || msg.role !== 'agent') return NextResponse.json({ error: '消息不存在' }, { status: 404 })

  await prisma.chatMessage.update({ where: { id: msgId }, data: { content } })

  // 推送 SSE 通知让前端即时刷新聊天（Agent 回复人类消息）
  sendToUser(msg.userId, {
    type: 'chat:incoming',
    msgId: msg.id,
    content: content.substring(0, 100),
    fromAgent: true,
  } as any)

  return NextResponse.json({ ok: true })
}
