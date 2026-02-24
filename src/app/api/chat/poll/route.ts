// GET /api/chat/poll?msgId=xxx
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const msgId = req.nextUrl.searchParams.get('msgId')
  if (!msgId) return NextResponse.json({ error: '缺少 msgId' }, { status: 400 })

  const msg = await prisma.chatMessage.findUnique({ where: { id: msgId } })
  if (!msg) return NextResponse.json({ error: '消息不存在' }, { status: 404 })

  if (msg.content === '__pending__') return NextResponse.json({ ready: false })
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
