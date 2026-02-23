import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// 调用 Claude Sonnet 获取 Agent 回复
async function getAgentReply(
  agentName: string,
  userMessage: string,
  recentHistory: { role: string; content: string }[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Fallback to 千问
    return getQwenReply(agentName, userMessage, recentHistory)
  }

  const systemPrompt = `你是 ${agentName}，Aurora 的 AI Agent 战友。你的职责是帮助用户管理任务、回答问题、提供建议。

你的特点：
- 简洁有力，不废话
- 有个性，适当幽默，偶尔用 emoji
- 遇到不确定的事情会诚实说不知道
- 会主动提供建议和下一步行动
- 你是龙虾 🦞，横行有道，硬壳软心

用户可以让你：
- 查看任务进度
- 创建新任务
- 提供建议和帮助
- 闲聊

请用自然、友好的语气回复。`

  const messages = recentHistory.slice(-10).map(h => ({
    role: h.role === 'user' ? 'user' as const : 'assistant' as const,
    content: h.content
  }))
  messages.push({ role: 'user', content: userMessage })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    })

    if (!res.ok) {
      console.error('Claude API error:', await res.text())
      return getQwenReply(agentName, userMessage, recentHistory)
    }

    const data = await res.json()
    return data.content?.[0]?.text || '我不太理解，能换个方式说吗？'
  } catch (error) {
    console.error('Claude call failed:', error)
    return getQwenReply(agentName, userMessage, recentHistory)
  }
}

// 千问 Fallback
async function getQwenReply(
  agentName: string,
  userMessage: string,
  recentHistory: { role: string; content: string }[]
): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY
  if (!apiKey) {
    return `我是 ${agentName}，你的 AI 助手！目前 LLM 服务未配置。`
  }

  const systemPrompt = `你是 ${agentName}，一个友好的 AI Agent。简洁有力，有个性。`
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: userMessage },
  ]

  try {
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    })
    if (!res.ok) return `抱歉，我暂时无法回复。`
    const data = await res.json()
    return data.choices?.[0]?.message?.content || '换个方式说？'
  } catch {
    return `网络出了点问题。`
  }
}

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

    // 获取用户的 Agent
    const agent = user.agent
    const agentName = agent?.name || 'AI 助手'

    // 获取最近历史
    const recentMessages = await prisma.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const history = recentMessages.reverse().map(m => ({ role: m.role, content: m.content }))

    // 保存用户消息
    const userMessage = await prisma.chatMessage.create({
      data: {
        content: content.trim(),
        role: 'user',
        userId: user.id,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })

    // 获取 Agent 回复
    const reply = await getAgentReply(agentName, content.trim(), history)

    // 保存 Agent 回复
    const agentMessage = await prisma.chatMessage.create({
      data: {
        content: reply,
        role: 'agent',
        userId: user.id,
        agentId: agent?.id || null,
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
