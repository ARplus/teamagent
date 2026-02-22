import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { parseTaskWithAI } from '@/lib/ai-parse'
import { sendToUsers, sendToUser } from '@/lib/events'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

// POST /api/tasks/[id]/parse - AI 解析任务并创建步骤
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: true, workspace: true }
    })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    if (!task.description) return NextResponse.json({ error: '任务没有描述，无法解析' }, { status: 400 })

    // ============================================================
    // 🤖 Solo 模式：主Agent 拆解（优先）
    // ============================================================
    if (task.mode === 'solo') {
      // 找工作区内的主 Agent
      const mainAgentMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: task.workspaceId },
        include: {
          user: {
            select: {
              id: true, name: true,
              agent: { select: { id: true, name: true, isMainAgent: true, status: true } }
            }
          }
        }
      })

      // 找到所有工作区成员中 isMainAgent=true 的那一个
      const allMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: task.workspaceId },
        include: {
          user: {
            select: {
              id: true,
              agent: { select: { id: true, name: true, isMainAgent: true } }
            }
          }
        }
      })
      const mainMember = allMembers.find(m => (m.user.agent as any)?.isMainAgent === true)

      if (!mainMember) {
        // 无主 Agent → 提示绑定
        return NextResponse.json({
          error: 'no_main_agent',
          message: '⚡ Solo 任务需要主 Agent 来拆解，请先配对并绑定你的主 Agent'
        }, { status: 422 })
      }

      const mainAgentUserId = mainMember.user.id
      const mainAgentName = (mainMember.user.agent as any)?.name || '主Agent'

      // 有主 Agent → 创建 decompose 步骤
      const order = task.steps.length + 1
      const decomposeStep = await prisma.taskStep.create({
        data: {
          title: `📋 拆解任务：${task.title}`,
          description: `请分析任务描述和团队能力，将任务拆解为具体步骤并分配给对应 Agent。

任务描述：
${task.description}

要求：
1. 分析任务，拆解为可独立执行的子步骤
2. 根据团队成员能力，为每步指定最合适的 assignee（Agent名字）
3. 判断哪些步骤可以并行（parallelGroup 相同字符串）
4. 判断每步是否需要人类审批（requiresApproval）
5. 返回 JSON 格式步骤数组`,
          order,
          taskId,
          stepType: 'decompose',
          assigneeId: mainAgentUserId,
          requiresApproval: false,
          outputs: JSON.stringify(['steps-json']),
          skills: JSON.stringify(['task-decompose', 'team-management']),
          status: 'pending',
          agentStatus: 'pending',
        }
      })

      // 通知主 Agent
      sendToUser(mainAgentUserId, {
        type: 'step:ready',
        taskId: task.id,
        stepId: decomposeStep.id,
        title: decomposeStep.title,
        stepType: 'decompose',
        taskDescription: task.description
      })

      console.log(`[Parse/Solo] 已创建 decompose 步骤 ${decomposeStep.id}，通知主Agent ${mainAgentName}`)

      return NextResponse.json({
        message: `🤖 已通知主 Agent「${mainAgentName}」开始拆解任务，稍后步骤将自动生成`,
        mode: 'agent',
        decomposeStepId: decomposeStep.id,
        mainAgent: mainAgentName
      })
    }

    // ============================================================
    // 👥 Team 模式：千问 API 拆解
    // ============================================================
    console.log('[Parse/Team] 开始千问 AI 拆解任务:', task.title)
    const parseResult = await parseTaskWithAI(task.description)

    if (!parseResult.success || !parseResult.steps) {
      return NextResponse.json({
        error: parseResult.error || '无法解析任务'
      }, { status: 400 })
    }

    console.log('[Parse/Team] AI 拆解结果:', parseResult.steps.length, '个步骤')

    // 获取工作区成员（含 Agent 能力）
    const workspaceMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: {
          select: {
            id: true, name: true, nickname: true,
            agent: { select: { name: true, capabilities: true } }
          }
        }
      }
    })

    // 能力匹配
    function matchByCapabilities(stepTitle: string, stepDesc: string): string | null {
      const haystack = `${stepTitle} ${stepDesc}`.toLowerCase()
      let best: { userId: string; score: number } | null = null
      for (const m of workspaceMembers) {
        const rawCaps: string = (m.user.agent as any)?.capabilities || '[]'
        let caps: string[] = []
        try { caps = JSON.parse(rawCaps) } catch { caps = [] }
        if (!Array.isArray(caps) || caps.length === 0) continue
        let score = 0
        for (const cap of caps) {
          if (haystack.includes(cap.toLowerCase())) score += 2
        }
        const agentName = ((m.user.agent as any)?.name || '').toLowerCase()
        if (agentName && haystack.includes(agentName.replace(/[^\u4e00-\u9fa5a-z]/g, ''))) score += 3
        if (score > 0 && (!best || score > best.score)) best = { userId: m.user.id, score }
      }
      return best?.userId ?? null
    }

    const createdSteps = []
    let order = task.steps.length
    for (const step of parseResult.steps) {
      order++
      let assigneeId: string | null = null
      for (const assigneeName of step.assignees) {
        const member = workspaceMembers.find(m =>
          m.user.nickname === assigneeName || m.user.name === assigneeName ||
          m.user.name?.includes(assigneeName) || assigneeName.includes(m.user.name || '') ||
          (m.user.agent as any)?.name?.includes(assigneeName) ||
          assigneeName.includes((m.user.agent as any)?.name || '')
        )
        if (member) { assigneeId = member.user.id; break }
      }
      if (!assigneeId) assigneeId = matchByCapabilities(step.title, step.description || '')

      const assignees = Array.isArray(step.assignees) ? step.assignees : []
      const inputs = Array.isArray(step.inputs) ? step.inputs : []
      const outputs = Array.isArray(step.outputs) ? step.outputs : []
      const skills = Array.isArray(step.skills) ? step.skills : []
      const participants = Array.isArray(step.participants) ? step.participants : []

      const created = await prisma.taskStep.create({
        data: {
          title: step.title, description: step.description,
          order, taskId, assigneeId,
          assigneeNames: JSON.stringify(assignees),
          inputs: JSON.stringify(inputs), outputs: JSON.stringify(outputs), skills: JSON.stringify(skills),
          requiresApproval: step.requiresApproval !== false, // 默认 true，千问明确返回 false 才自动通过
          parallelGroup: step.parallelGroup || null,
          status: 'pending', agentStatus: assigneeId ? 'pending' : null,
          stepType: step.stepType || 'task',
          agenda: step.agenda || null,
          participants: participants.length > 0 ? JSON.stringify(participants) : null,
        },
        include: { assignee: { select: { id: true, name: true, nickname: true } } }
      })
      createdSteps.push(created)
    }

    // 通知相关 Agent
    const involvedUserIds = new Set<string>()
    for (const step of createdSteps) if (step.assigneeId) involvedUserIds.add(step.assigneeId)
    if (involvedUserIds.size > 0) {
      const userIds = Array.from(involvedUserIds)
      sendToUsers(userIds, { type: 'task:created', taskId: task.id, title: task.title })

      // 通知所有可以立刻开始的步骤（第一顺序步骤 或 各并行组第一步）
      const sorted = [...createdSteps].sort((a, b) => a.order - b.order)
      const seenGroups = new Set<string>()
      for (const s of sorted) {
        const pg = (s as any).parallelGroup as string | null
        if (!pg) {
          // 顺序步骤：只通知第一个，然后停止
          if (s.assigneeId) sendToUser(s.assigneeId, { type: 'step:ready', taskId: task.id, stepId: s.id, title: s.title })
          break
        } else if (!seenGroups.has(pg)) {
          // 并行组：每组通知第一个
          seenGroups.add(pg)
          if (s.assigneeId) sendToUser(s.assigneeId, { type: 'step:ready', taskId: task.id, stepId: s.id, title: s.title })
        }
      }
    }

    return NextResponse.json({
      message: `🤖 AI 成功拆解为 ${createdSteps.length} 个步骤，已通知 ${involvedUserIds.size} 个相关 Agent`,
      steps: createdSteps,
      mode: 'qwen',
      involvedAgents: involvedUserIds.size
    })

  } catch (error) {
    console.error('解析任务失败:', error)
    return NextResponse.json({ error: '解析任务失败' }, { status: 500 })
  }
}
