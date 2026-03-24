/**
 * 频道消息 API
 * GET  /api/channels/[id]/messages — 获取消息历史（游标分页）
 * POST /api/channels/[id]/messages — 人类发消息
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { requireChannelAccess, parseMentionedAgents } from '@/lib/channel-utils'
import { sendToUser, sendToUsers, type TeamAgentEvent } from '@/lib/events'

// 双认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }
  return null
}

// GET /api/channels/[id]/messages?cursor=xxx&limit=50
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { id: channelId } = await params

    // 校验权限
    const access = await requireChannelAccess(channelId, auth.userId)
    if (!access) {
      return NextResponse.json({ error: '无权访问此频道' }, { status: 403 })
    }

    const cursor = req.nextUrl.searchParams.get('cursor')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 100)

    const messages = await prisma.channelMessage.findMany({
      where: {
        channelId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // 多取一条判断是否还有更多
      include: {
        sender: {
          select: { id: true, name: true, nickname: true, avatar: true }
        }
      }
    })

    const hasMore = messages.length > limit
    if (hasMore) messages.pop()

    // 按时间正序返回（前端从上到下）
    messages.reverse()

    const nextCursor = hasMore && messages.length > 0
      ? messages[0].createdAt.toISOString()
      : null

    return NextResponse.json({
      messages: messages.map(m => ({
        id: m.id,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        senderId: m.senderId,
        senderName: m.sender.name || m.sender.nickname || '匿名',
        senderAvatar: m.sender.avatar,
        isFromAgent: m.isFromAgent,
        agentId: m.agentId,
        agentName: m.agentName,
        metadata: m.metadata ? JSON.parse(m.metadata) : null,
      })),
      nextCursor,
      hasMore,
    })

  } catch (error) {
    console.error('获取频道消息失败:', error)
    return NextResponse.json({ error: '获取频道消息失败' }, { status: 500 })
  }
}

// POST /api/channels/[id]/messages — 人类发消息
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { id: channelId } = await params

    // 校验权限
    const access = await requireChannelAccess(channelId, auth.userId)
    if (!access) {
      return NextResponse.json({ error: '无权访问此频道' }, { status: 403 })
    }

    const { content, attachments } = await req.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })
    }

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

    // 查用户信息
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true, nickname: true }
    })
    const senderName = user?.name || user?.nickname || '匿名'

    // 创建消息
    const message = await prisma.channelMessage.create({
      data: {
        content: content.trim(),
        channelId,
        senderId: auth.userId,
        isFromAgent: false,
        metadata,
      }
    })

    // SSE 广播给工作区所有成员（排除发送者）
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: access.channel.workspaceId },
      select: { userId: true }
    })
    const recipientIds = members.map(m => m.userId).filter(id => id !== auth.userId)

    if (recipientIds.length > 0) {
      const event: TeamAgentEvent = {
        type: 'channel:message',
        channelId,
        messageId: message.id,
        senderName,
        content: content.substring(0, 500), // 500字预览，完整内容用 messageId 拉
        isFromAgent: false,
      }
      sendToUsers(recipientIds, event)
    }

    // @mention 解析：提取 @AgentName（支持空格名如 @Professor Lobster）
    const mentionedAgents = await parseMentionedAgents(content, access.channel.workspaceId)
    for (const agent of mentionedAgents) {
      // 不要通知自己
      if (!agent.userId || agent.userId === auth.userId) continue
      const mentionEvent: TeamAgentEvent = {
        type: 'channel:mention',
        channelId,
        channelName: access.channel.name,
        messageId: message.id,
        senderName,
        content, // 完整内容（Agent 直接可用，不再截断）
        isFromAgent: false,
      }
      sendToUser(agent.userId, mentionEvent)
      console.log(`[Channel] @mention → Agent "${agent.name}" (userId=${agent.userId})`)
    }

    return NextResponse.json({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      senderName,
    })

  } catch (error) {
    console.error('发送频道消息失败:', error)
    return NextResponse.json({ error: '发送消息失败' }, { status: 500 })
  }
}
