import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'
const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * 调用 LLM 从自然语言提取任务信息
 */
async function extractTaskFromChat(message: string): Promise<{ title: string; description: string; mode: 'solo' | 'team' }> {
  const systemPrompt = `你是 TeamAgent 的任务提取助手。用户用自然语言描述了一个任务需求，请从中提取结构化信息。

## 输出格式（严格 JSON）
{
  "title": "简短的任务标题（不超过30字）",
  "description": "完整的任务描述",
  "mode": "solo 或 team"
}

## 规则
- title: 从用户描述中提取核心需求作为标题，简洁明了
- description: 保留用户的完整意图，可以适当补充细节
- mode: 如果用户提到需要多人协作、团队合作、一起等关键词，设为 "team"；否则默认 "solo"
- 只输出 JSON，不要其他内容`

  // 优先 Claude
  if (ANTHROPIC_API_KEY) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 15_000)
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
          temperature: 0.2,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(t))
      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text
        if (text) {
          let raw = text.trim()
          if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          return JSON.parse(raw)
        }
      }
    } catch { /* fallback */ }
  }

  // 降级千问
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 30_000)
    const res = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${QWEN_API_KEY}` },
      body: JSON.stringify({
        model: 'qwen-max-latest',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: ac.signal,
    }).finally(() => clearTimeout(t))
    if (res.ok) {
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content
      if (text) return JSON.parse(text.trim())
    }
  } catch { /* fallthrough */ }

  // 最终 fallback：直接用用户输入
  return {
    title: message.replace(/\s+/g, ' ').slice(0, 28),
    description: message,
    mode: 'solo',
  }
}

/**
 * POST /api/tasks/create-from-chat
 * 对话式创建任务：从自然语言提取标题和描述，创建任务
 * 拆解逻辑复用 POST /api/tasks 的 solo/team 模式触发方式
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    const { message, mode: userMode } = await req.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: '请描述你想创建的任务' }, { status: 400 })
    }

    // 1. LLM 提取任务信息
    console.log(`[CreateFromChat] 提取任务: "${message.substring(0, 50)}..."`)
    const extracted = await extractTaskFromChat(message.trim())
    // 用户明确指定 mode 时覆盖 LLM 推断
    if (userMode === 'solo' || userMode === 'team') {
      extracted.mode = userMode
    }
    console.log(`[CreateFromChat] 提取结果: ${extracted.title} (${extracted.mode})`)

    // 2. 获取用户的工作区
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      select: { workspaceId: true }
    })
    if (!membership) {
      return NextResponse.json({ error: '请先创建或加入一个工作区' }, { status: 400 })
    }

    // 3. 创建任务
    const task = await prisma.task.create({
      data: {
        title: extracted.title,
        description: extracted.description,
        status: 'todo',
        priority: 'medium',
        mode: extracted.mode,
        creatorId: user.id,
        workspaceId: membership.workspaceId,
      },
    })

    // 4. SSE 通知
    sendToUser(user.id, { type: 'task:created', taskId: task.id, title: task.title })

    // 5. Solo 模式：通知主 Agent 进行 decompose
    if (extracted.mode === 'solo' && extracted.description) {
      try {
        const allMembers = await prisma.workspaceMember.findMany({
          where: { workspaceId: membership.workspaceId },
          include: { user: { select: { id: true, agent: { select: { id: true, name: true, isMainAgent: true } } } } }
        })
        // Solo: 优先找创建者自己的主 Agent，兜底任意主 Agent
        const mainMember = allMembers.find(m => m.user.id === user.id && (m.user.agent as any)?.isMainAgent)
          || allMembers.find(m => (m.user.agent as any)?.isMainAgent === true)
        if (mainMember) {
          const mainAgentUserId = mainMember.user.id
          const decomposeStep = await prisma.taskStep.create({
            data: {
              title: `📋 拆解任务：${task.title}`,
              description: `请分析任务描述和团队能力，将任务拆解为具体步骤并分配给对应 Agent。\n\n任务描述：\n${task.description}\n\n要求：\n1. 拆解为可独立执行的子步骤\n2. 为每步指定最合适的 assignee（Agent名字）\n3. 判断哪些步骤可以并行（parallelGroup 相同字符串）\n4. 判断每步是否需要人类审批（requiresApproval）\n5. 返回 JSON 格式步骤数组`,
              order: 1, taskId: task.id, stepType: 'decompose',
              assigneeId: mainAgentUserId, requiresApproval: false,
              outputs: JSON.stringify(['steps-json']),
              skills: JSON.stringify(['task-decompose', 'team-management']),
              status: 'pending', agentStatus: 'pending',
            }
          })
          await prisma.stepAssignee.create({
            data: { stepId: decomposeStep.id, userId: mainAgentUserId, isPrimary: true, assigneeType: 'agent' }
          }).catch(() => {})
          sendToUser(mainAgentUserId, {
            type: 'step:ready', taskId: task.id, stepId: decomposeStep.id,
            title: decomposeStep.title, stepType: 'decompose', taskDescription: task.description || ''
          })
          console.log(`[CreateFromChat] Solo → decompose 已通知主 Agent`)
        }
      } catch (e) {
        console.warn('[CreateFromChat] Solo decompose 触发失败:', e)
      }
    }

    // 6. Team 模式：可插拔拆解（main-agent 优先，hub-llm 降级）
    if (extracted.mode === 'team' && extracted.description) {
      const { orchestrateDecompose } = await import('@/lib/decompose-orchestrator')
      orchestrateDecompose({
        taskId: task.id,
        title: task.title,
        description: task.description!,
        supplement: task.supplement,
        workspaceId: membership.workspaceId,
        creatorId: user.id,
      }).catch(e => console.warn('[CreateFromChat] orchestrateDecompose:', e?.message))
    }

    return NextResponse.json({
      task: { id: task.id, title: task.title, description: task.description, mode: task.mode, status: task.status }
    })
  } catch (error) {
    console.error('[CreateFromChat] 失败:', error)
    return NextResponse.json({ error: '创建任务失败', detail: error instanceof Error ? error.message : '未知错误' }, { status: 500 })
  }
}
