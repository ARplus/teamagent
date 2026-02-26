import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

// ============ 上下文类型 ============
interface TaskContext {
  id: string
  title: string
  status: string
  stepCount: number
  pendingSteps: { id: string; title: string; status: string }[]
}

interface AgentContext {
  agentName: string
  userName: string
  tasks: TaskContext[]
  pendingApprovals: { stepId: string; stepTitle: string; taskTitle: string }[]
}

// ============ 拉取用户上下文 ============
async function getUserContext(userId: string, agentName: string, userName: string): Promise<AgentContext> {
  const tasks = await prisma.task.findMany({
    where: { creatorId: userId, status: { not: 'done' } },
    include: {
      steps: {
        where: { status: { in: ['pending', 'in_progress', 'waiting_approval'] } },
        take: 3,
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  })

  const pendingApprovals: AgentContext['pendingApprovals'] = []
  const taskContexts: TaskContext[] = tasks.map(t => {
    const pending = t.steps.filter(s => s.status === 'waiting_approval')
    pending.forEach(s => pendingApprovals.push({
      stepId: s.id,
      stepTitle: s.title,
      taskTitle: t.title,
    }))
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      stepCount: t.steps.length,
      pendingSteps: t.steps.map(s => ({ id: s.id, title: s.title, status: s.status })),
    }
  })

  return { agentName, userName, tasks: taskContexts, pendingApprovals }
}

// ============ 构建系统提示词 ============
function buildSystemPrompt(ctx: AgentContext): string {
  const taskSummary = ctx.tasks.length === 0
    ? '目前没有进行中的任务。'
    : ctx.tasks.map(t => {
        const steps = t.pendingSteps.length > 0
          ? `（${t.pendingSteps.map(s => `${s.title}:${s.status}`).join('，')}）`
          : ''
        return `• [${t.id.slice(-6)}] ${t.title}（${t.status}）${steps}`
      }).join('\n')

  const approvalSummary = ctx.pendingApprovals.length === 0
    ? '没有待审批步骤。'
    : ctx.pendingApprovals.map(a => `• 步骤「${a.stepTitle}」（任务：${a.taskTitle}，stepId: ${a.stepId}）`).join('\n')

  return `你是 ${ctx.agentName}，${ctx.userName} 的专属 AI Agent。你不只是聊天机器人——你能真正执行操作。

== 当前状态 ==
进行中任务（${ctx.tasks.length} 个）：
${taskSummary}

待审批步骤（${ctx.pendingApprovals.length} 个）：
${approvalSummary}

== 你的能力 ==
1. 查看任务 → 汇报任务进度、状态
2. 创建任务 → 用户说"帮我建个任务/新建/创建xxx"时
3. 审批步骤 → 用户说"审批/通过/批准xxx"时
4. 闲聊和建议 → 普通对话

== 执行操作的格式 ==
当需要执行操作时，在回复末尾附上 JSON 指令（用 @@ACTION@@ 标记）：

创建任务示例：
这就帮你创建！@@ACTION@@{"type":"create_task","title":"任务标题","description":"任务描述"}@@END@@

审批步骤示例：
好，帮你审批！@@ACTION@@{"type":"approve_step","stepId":"步骤ID"}@@END@@

== 性格 ==
- 简洁有力，不废话
- 有个性，偶尔用 emoji 🦞
- 硬壳软心，横行有道
- 说不到就说做不到，不瞎承诺`
}

// ============ 解析并执行 Action ============
async function executeAction(
  actionJson: string,
  userId: string,
  agentId: string | null
): Promise<string> {
  let action: { type: string; [key: string]: string }
  try {
    action = JSON.parse(actionJson)
  } catch {
    return ''
  }

  try {
    if (action.type === 'create_task') {
      // 找用户默认 workspace
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId },
        select: { workspaceId: true },
      })
      if (!membership) return '\n\n❌ 请先加入或创建一个工作区。'

      const task = await prisma.task.create({
        data: {
          title: action.title || '新任务',
          description: action.description || '',
          status: 'todo',
          mode: 'solo',
          creatorId: userId,
          workspaceId: membership.workspaceId,
        },
      })
      return `\n\n✅ 任务「${task.title}」已创建！`
    }

    if (action.type === 'approve_step') {
      const step = await prisma.taskStep.findUnique({
        where: { id: action.stepId },
        include: { task: true },
      })
      if (!step) return '\n\n❌ 找不到该步骤。'
      if (step.task.creatorId !== userId && step.assigneeId !== userId)
        return '\n\n❌ 你没有权限审批这个步骤。'
      if (step.status !== 'waiting_approval')
        return `\n\n⚠️ 步骤「${step.title}」当前状态是「${step.status}」，不需要审批。`

      const now = new Date()
      // 更新最新 submission
      const latestSub = await prisma.stepSubmission.findFirst({
        where: { stepId: action.stepId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      })
      if (latestSub) {
        await prisma.stepSubmission.update({
          where: { id: latestSub.id },
          data: { status: 'approved', reviewedAt: now, reviewedBy: userId },
        })
      }
      await prisma.taskStep.update({
        where: { id: action.stepId },
        data: { status: 'done', approvedAt: now, approvedBy: userId },
      })
      return `\n\n✅ 步骤「${step.title}」已审批通过！`
    }
  } catch (err) {
    console.error('Action execution error:', err)
    return '\n\n⚠️ 操作执行时出了点问题。'
  }

  return ''
}

// ============ 调用 LLM ============
async function callLLM(
  systemPrompt: string,
  userMessage: string,
  history: { role: string; content: string }[]
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  const messages = history.slice(-10).map(h => ({
    role: h.role === 'user' ? 'user' as const : 'assistant' as const,
    content: h.content,
  }))
  messages.push({ role: 'user', content: userMessage })

  // 优先 Claude
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        return data.content?.[0]?.text || '我不太理解，能换个方式说吗？'
      }
    } catch {}
  }

  return '当前对话仅允许由你的专属 Agent 回复。请确保 Agent 在线后再试。'
}

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

    // 强制走专属 Agent 链路：禁止 fallback 到其它模型（如千问）
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

    // 5. 构建提示词 + 调用 LLM（Agent 不在线时 fallback）
    const systemPrompt = buildSystemPrompt(ctx)
    let reply = await callLLM(systemPrompt, content.trim(), history)

    // 6. 解析并执行 Action
    const actionMatch = reply.match(/@@ACTION@@([\s\S]*?)@@END@@/)
    if (actionMatch) {
      const actionResult = await executeAction(actionMatch[1].trim(), user.id, null)
      // 移除 action JSON，追加执行结果
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
