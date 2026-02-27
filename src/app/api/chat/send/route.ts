import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { getUserContext, buildSystemPrompt, callLLM, executeAction } from '@/lib/chat-llm'

// ============ 主处理 ============
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: true },
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const { content, metadata } = await req.json()
    if (!content?.trim()) {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })
    }

    const agent = user.agent
    const agentName = agent?.name || 'AI 助手'
    const userName = user.name || user.email?.split('@')[0] || '用户'

    // 1. 拉取上下文
    const ctx = await getUserContext(user.id, agentName, userName)

    // 2. 获取聊天历史
    const recentMessages = await prisma.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const history = recentMessages.reverse().map(m => ({ role: m.role, content: m.content }))

    // 3. 保存用户消息
    const userMessage = await prisma.chatMessage.create({
      data: {
        content: content.trim(),
        role: 'user',
        userId: user.id,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })

    // 有 Agent 时走 SSE 推送链路，30 秒超时由 poll 端点兜底
    if (agent) {
      // 创建 pending 占位消息
      const agentMessage = await prisma.chatMessage.create({
        data: {
          content: '__pending__',
          role: 'agent',
          userId: user.id,
          agentId: agent.id,
        },
      })

      // 推送 chat:incoming 事件给 agent-worker
      sendToUser(user.id, {
        type: 'chat:incoming',
        msgId: agentMessage.id,
        content: content.trim(),
        agentId: agent.id,
      })

      return NextResponse.json({
        userMessageId: userMessage.id,
        agentMessageId: agentMessage.id,
        pending: true,
      })
    }

    // 5. 构建提示词 + 调用 LLM（无 Agent 时直接回复）
    const systemPrompt = buildSystemPrompt(ctx)
    let reply = await callLLM(systemPrompt, content.trim(), history)

    // 6. 解析并执行 Action
    const actionMatch = reply.match(/@@ACTION@@([\s\S]*?)@@END@@/)
    if (actionMatch) {
      const actionResult = await executeAction(actionMatch[1].trim(), user.id, null)
      reply = reply.replace(/@@ACTION@@[\s\S]*?@@END@@/, '').trim() + actionResult
    }

    // 7. 保存 Agent 回复（LLM fallback 情况）
    const agentMessage = await prisma.chatMessage.create({
      data: {
        content: reply,
        role: 'agent',
        userId: user.id,
        agentId: null,
      },
    })

    return NextResponse.json({
      userMessageId: userMessage.id,
      agentMessage: {
        id: agentMessage.id,
        content: agentMessage.content,
        role: agentMessage.role,
        createdAt: agentMessage.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('发送消息失败:', error)
    return NextResponse.json({ error: '发送消息失败' }, { status: 500 })
  }
}
