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

  // 找到主人（Agent 的 owner）
  // Agent 的 userId 就是 Agent 自己的 User 记录，主人是通过 workspace 关系关联的
  // 但更直接的方式：Agent 的消息目标就是它的 owner
  // 在当前架构中，chat 是 user ↔ agent，agent 的 userId 就是 agent-user
  // 人类主人通过 agent.userId → user 找到 agent → 主人是谁？
  // 实际上 ChatMessage 的 userId 是人类用户的 ID
  // 所以我们需要找到谁"拥有"这个 agent

  // 查找把这个 agent 作为 "自己的 agent" 的人类用户
  // 方法：找到 agent 记录，它的 user 就是 agent-user，
  //        但人类用户通过 User.agent 关联（1:1 关系）
  // 实际上当前架构：每个 Agent 有一个 userId（@unique），对应一个 User
  // 人类用户也是 User，通过 User.agent 关联自己的 agent
  // Agent 的 userId 指向的是 Agent 自己的 User 记录
  // 人类主人 = 谁的 agent.id === 这个 agent 的 id

  // 最简单的方式：从 ChatMessage 找到最近和这个 agent 对话的人类
  const lastChat = await prisma.chatMessage.findFirst({
    where: { agentId: agent.id, role: 'user' },
    orderBy: { createdAt: 'desc' },
    select: { userId: true }
  })

  // 如果没有历史对话，尝试通过 workspace 关系找主人
  let ownerId = lastChat?.userId
  if (!ownerId) {
    // Agent 在 workspace 中，找 workspace 的 owner
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: agent.userId! },
      select: { workspaceId: true }
    })
    if (membership) {
      const ownerMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: membership.workspaceId, role: 'owner' },
        select: { userId: true }
      })
      ownerId = ownerMember?.userId
    }
  }

  if (!ownerId) {
    return NextResponse.json({ error: '找不到 Agent 的主人' }, { status: 404 })
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
  sendToUser(ownerId, {
    type: 'chat:incoming',
    msgId: message.id,
    content: content.trim().substring(0, 100),
    agentId: agent.id,
  })

  return NextResponse.json({
    ok: true,
    messageId: message.id,
    sentTo: ownerId,
  })
}
