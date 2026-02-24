// POST /api/chat/reply
// Bearer <agent-token>
// { msgId: string, content: string }
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

  const { msgId, content } = await req.json()
  if (!msgId || !content) return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  const msg = await prisma.chatMessage.findUnique({ where: { id: msgId } })
  if (!msg || msg.role !== 'agent') return NextResponse.json({ error: '消息不存在' }, { status: 404 })

  await prisma.chatMessage.update({ where: { id: msgId }, data: { content } })
  return NextResponse.json({ ok: true })
}
