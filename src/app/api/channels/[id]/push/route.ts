/**
 * Agent 频道发消息 API
 * POST /api/channels/[id]/push — Agent 通过 token 发消息到频道
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { requireChannelAccess, parseMentionedAgents } from '@/lib/channel-utils'
import { sendToUser, sendToUsers, type TeamAgentEvent } from '@/lib/events'

// POST /api/channels/[id]/push
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Agent token 认证
    const tokenAuth = await authenticateRequest(req)
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token 认证' }, { status: 401 })
    }

    const { id: channelId } = await params
    const userId = tokenAuth.user.id

    // 校验频道权限
    const access = await requireChannelAccess(channelId, userId)
    if (!access) {
      return NextResponse.json({ error: '无权访问此频道' }, { status: 403 })
    }

    const { content, attachments } = await req.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })
    }

    // 获取 Agent 信息
    const agent = await prisma.agent.findUnique({
      where: { userId },
      select: { id: true, name: true }
    })
    const agentName = agent?.name || 'Agent'
    const agentId = agent?.id || null

    // 处理附件
    let metadata: string | null = null
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      const validAttachments = attachments
        .filter((a: any) => a.url && typeof a.url === 'string')
        .slice(0, 10)
        .map((a: any) => ({
          type: a.type || 'file',
          name: a.name || 'attachment',
          url: a.url,
          size: a.size || null,
        }))
      if (validAttachments.length > 0) {
        metadata = JSON.stringify({ attachments: validAttachments })
      }
    }

    // 创建消息
    const message = await prisma.channelMessage.create({
      data: {
        content: content.trim(),
        channelId,
        senderId: userId,
        isFromAgent: true,
        agentId,
        agentName,
        metadata,
      }
    })

    // SSE 广播给工作区所有成员（排除发送者）
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: access.channel.workspaceId },
      select: { userId: true }
    })
    const recipientIds = members.map(m => m.userId).filter(id => id !== userId)

    if (recipientIds.length > 0) {
      const event: TeamAgentEvent = {
        type: 'channel:message',
        channelId,
        messageId: message.id,
        senderName: agentName,
        content: content,
        isFromAgent: true,
        agentName,
      }
      sendToUsers(recipientIds, event)
    }

    // @mention 解析：Agent 发的消息 **不** 触发其他 Agent 的 channel:mention
    // 防止 Agent ↔ Agent 死循环（A @B → B 回复 @A → A 回复 @B → ∞）
    // 人类 @Agent 仍然由 messages/route.ts 正常触发
    // Agent push 只做 channel:message 广播，不做 mention 解析
    console.log(`[Channel] Agent push → 跳过 @mention 解析（防死循环）`)

    return NextResponse.json({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      agentName,
      channelId,
    })

  } catch (error) {
    console.error('Agent 发送频道消息失败:', error)
    return NextResponse.json({ error: '发送消息失败' }, { status: 500 })
  }
}
