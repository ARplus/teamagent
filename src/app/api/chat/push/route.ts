// POST /api/chat/push
// Agent 主动发消息（每次创建新消息，不绑定已有 msgId）
// Bearer <agent-token>
// { content: string, targetUserId?: string }
//
// 与 /api/chat/reply 的区别：
//   reply  → 更新已有 agent 占位消息（同一个 msgId 发三次 = 覆盖前两条）
//   push   → 每次创建全新消息（三次调用 = 三条独立消息）
//
// targetUserId 可选：
//   不传 → 发给 Agent 的主人（owner）
//   传了 → 发给指定用户（需在同一 workspace）

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req)
  if (!auth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

  const { content, targetUserId, attachments } = await req.json()
  if (!content?.trim()) {
    return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })
  }

  // v15.1: 附件校验（可选）
  // attachments: [{ type: "image/png", name: "封面.png", url: "https://..." }]
  let validAttachments: { type: string; name: string; url: string }[] | null = null
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    validAttachments = attachments
      .filter((a: any) => a.url && typeof a.url === 'string')
      .slice(0, 10)  // 最多 10 个附件
      .map((a: any) => ({
        type: a.type || 'application/octet-stream',
        name: a.name || '附件',
        url: a.url,
      }))
  }

  // 找到发送者 Agent
  const agent = await prisma.agent.findFirst({
    where: { userId: auth.user.id },
    select: { id: true, name: true, userId: true }
  })

  if (!agent) {
    return NextResponse.json({ error: '当前用户没有关联的 Agent' }, { status: 404 })
  }

  // 确定目标用户
  let recipientId = targetUserId || agent.userId
  if (!recipientId) {
    return NextResponse.json({ error: 'Agent 尚未被认领，且未指定 targetUserId' }, { status: 400 })
  }

  // 如果指定了 targetUserId，验证目标用户存在
  if (targetUserId) {
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true }
    })
    if (!targetUser) {
      return NextResponse.json({ error: '目标用户不存在' }, { status: 404 })
    }
  }

  // 构建 metadata（附件存这里）
  const metadata = validAttachments ? JSON.stringify({ attachments: validAttachments }) : null

  // 创建全新消息（每次调用都生成新 ID）
  const message = await prisma.chatMessage.create({
    data: {
      content: content.trim(),
      role: 'agent',
      userId: recipientId,
      agentId: agent.id,
      metadata,
    },
  })

  // 推送 SSE 通知，fromAgent=true 让 agent-worker 忽略（防自回复循环）
  sendToUser(recipientId, {
    type: 'chat:incoming',
    msgId: message.id,
    content: content.trim().substring(0, 100),
    agentId: agent.id,
    agentName: agent.name,
    fromAgent: true,
    ...(validAttachments && { attachments: validAttachments }),
  } as any)

  return NextResponse.json({
    ok: true,
    messageId: message.id,
    sentTo: recipientId,
    ...(validAttachments && { attachments: validAttachments.length }),
  })
}
