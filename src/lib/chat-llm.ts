/**
 * 聊天 LLM 共享模块
 * 供 chat/send 和 chat/poll（超时兜底）共用
 */
import { prisma } from '@/lib/db'

// ============ 上下文类型 ============
interface TaskContext {
  id: string
  title: string
  status: string
  stepCount: number
  pendingSteps: { id: string; title: string; status: string }[]
}

export interface AgentContext {
  agentName: string
  userName: string
  tasks: TaskContext[]
  pendingApprovals: { stepId: string; stepTitle: string; taskTitle: string }[]
}

// ============ 拉取用户上下文 ============
export async function getUserContext(userId: string, agentName: string, userName: string): Promise<AgentContext> {
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
export function buildSystemPrompt(ctx: AgentContext): string {
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
export async function executeAction(
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
export async function callLLM(
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
      const apiUrl = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
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
