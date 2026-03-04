// POST /api/chat/agent-send
// Agent 主动给人类发消息（不是回复 pending 消息，是主动发起）
// Bearer <agent-token>
// { content: string }
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })

  // 找到这个 Agent 对应的人类主人
  const agent = await prisma.agent.findFirst({
    where: { userId: auth.user.id },
    select: { id: true, name: true, userId: true, user: { select: { id: true } } }
  })

  if (!agent) {
    return NextResponse.json({ error: '当前用户没有关联的 Agent' }, { status: 404 })
  }

  // Agent.userId 就是人类主人的 ID（claim 时设置的）
  const ownerId = agent.userId
  if (!ownerId) {
    return NextResponse.json({ error: 'Agent 尚未被认领，没有主人' }, { status: 404 })
  }

  // 保存 Agent 主动发送的消息
  const message = await prisma.chatMessage.create({
    data: {
      content: content.trim(),
      role: 'agent',
      userId: ownerId,
      agentId: agent.id,
    },
  })

  // 推送 SSE 通知给人类主人，让前端实时刷新
  // fromAgent: true 标记为 Agent 主动发送，agent-worker 应忽略不回复
  sendToUser(ownerId, {
    type: 'chat:incoming',
    msgId: message.id,
    content: content.trim().substring(0, 100),
    agentId: agent.id,
    fromAgent: true,
  } as any)

  return NextResponse.json({
    ok: true,
    messageId: message.id,
    sentTo: ownerId,
  })
}
