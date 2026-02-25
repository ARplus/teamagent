// GET /api/chat/unread
// Bearer <agent-token>
// 返回该 Agent 对应用户所有未回复（__pending__）或最近未读的聊天消息
// Query params:
//   since=<ISO timestamp>  只返回该时间之后的消息（用于 SSE 重连补拉）
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

  const userId = auth.user.id
  const since = req.nextUrl.searchParams.get('since')

  // 1. 未回复的 __pending__ 消息（agent 侧未回写）
  const pendingReplies = await prisma.chatMessage.findMany({
    where: { userId, role: 'agent', content: '__pending__' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true }
  })

  // 2. since 之后的用户消息（SSE 断连期间可能漏推的 chat:incoming）
  let missedUserMessages: { id: string; content: string; createdAt: Date }[] = []
  if (since) {
    const sinceDate = new Date(since)
    if (!isNaN(sinceDate.getTime())) {
      missedUserMessages = await prisma.chatMessage.findMany({
        where: {
          userId,
          role: 'user',
          createdAt: { gt: sinceDate }
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, content: true, createdAt: true }
      })
    }
  }

  return NextResponse.json({
    pendingReplies: pendingReplies.map(m => ({
      msgId: m.id,
      createdAt: m.createdAt.toISOString()
    })),
    missedMessages: missedUserMessages.map(m => ({
      msgId: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }))
  })
}
