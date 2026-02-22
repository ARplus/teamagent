import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, sendToUsers } from '@/lib/events'

const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * POST /api/steps/[id]/execute-decompose
 *
 * 主 Agent 专用：一键执行 decompose 步骤
 *   1. 验证是主 Agent 本人调用
 *   2. 获取任务描述 + 工作区团队能力
 *   3. 调用 LLM 生成步骤 JSON（团队感知）
 *   4. 自动认领 + 提交 → 触发子步骤展开
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stepId } = await params
    const tokenAuth = await authenticateRequest(req)
    if (!tokenAuth) return NextResponse.json({ error: '需要 API Token' }, { status: 401 })

    // 找 decompose 步骤
    const step = await prisma.taskStep.findUnique({
      where: { id: stepId },
      include: {
        task: {
          include: {
            workspace: true,
            steps: { select: { id: true, order: true } }
          }
        }
      }
    })

    if (!step) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    if (step.stepType !== 'decompose') return NextResponse.json({ error: '此步骤不是 decompose 类型' }, { status: 400 })
    if (step.assigneeId !== tokenAuth.user.id) return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    if (!['pending', 'in_progress'].includes(step.status)) return NextResponse.json({ error: `步骤状态异常: ${step.status}` }, { status: 400 })

    const task = step.task
    if (!task.description) return NextResponse.json({ error: '任务没有描述，无法拆解' }, { status: 400 })

    // 1. 认领步骤
    const now = new Date()
    await prisma.taskStep.update({
      where: { id: stepId },
      data: { status: 'in_progress', agentStatus: 'working', startedAt: now }
    })
    await prisma.agent.updateMany({
      where: { userId: tokenAuth.user.id },
      data: { status: 'working' }
    })

    // 2. 获取工作区团队成员 + 能力
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: {
          select: {
            id: true, name: true,
            agent: { select: { name: true, capabilities: true, isMainAgent: true } }
          }
        }
      }
    })

    const teamDesc = members
      .filter(m => m.user.agent)
      .map(m => {
        const a = m.user.agent!
        let caps: string[] = []
        try { caps = JSON.parse((a as any).capabilities || '[]') } catch {}
        return `- ${(a as any).name}（${(a as any).isMainAgent ? '主Agent' : '子Agent'}）: ${caps.length > 0 ? caps.join('、') : '通用'}`
      })
      .join('\n')

    // 3. 构建团队感知的拆解 Prompt
    const systemPrompt = `你是 TeamAgent 的主 Agent，负责将任务拆解为最优执行方案。

## 团队成员及能力
${teamDesc || '（暂无子 Agent，步骤可分配给主 Agent 自己）'}

## 输出格式（JSON 数组）
[
  {
    "title": "步骤标题",
    "description": "详细说明",
    "assignee": "Agent名字（必须是上面列出的成员之一）",
    "requiresApproval": true,
    "parallelGroup": null,
    "inputs": ["依赖的输入"],
    "outputs": ["产出物"],
    "skills": ["需要的技能"]
  }
]

## 拆解规则
1. 根据团队能力匹配最合适的 assignee（必须用 Agent 名字，不是用户名）
2. 可并行的步骤设相同的 parallelGroup 字符串（如 "调研"、"开发"）
3. 顺序执行的步骤 parallelGroup 设为 null
4. 需要人类决策或检查质量的关键步骤，requiresApproval 设为 true
5. 中间过渡步骤或无需审查的 requiresApproval 设为 false
6. 最少 2 步，最多 8 步

只输出 JSON 数组，不要其他内容。`

    const userMessage = `请根据团队能力，将以下任务拆解为步骤：\n\n${task.description}`

    // 4. 调用 LLM
    console.log(`[ExecuteDecompose] 调用 LLM 拆解任务: ${task.title}`)
    const llmRes = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen-max',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    })

    if (!llmRes.ok) {
      const err = await llmRes.text()
      console.error('[ExecuteDecompose] LLM 错误:', err)
      return NextResponse.json({ error: `LLM 调用失败: ${llmRes.status}` }, { status: 500 })
    }

    const llmData = await llmRes.json()
    const content = llmData.choices?.[0]?.message?.content
    if (!content) return NextResponse.json({ error: 'LLM 无返回内容' }, { status: 500 })

    // 解析 JSON（可能是数组或包含 steps 字段的对象）
    let parsedSteps: any[]
    try {
      const parsed = JSON.parse(content)
      parsedSteps = Array.isArray(parsed) ? parsed : (parsed.steps ?? [])
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) throw new Error('空数组')
    } catch {
      console.error('[ExecuteDecompose] JSON 解析失败:', content.substring(0, 200))
      return NextResponse.json({ error: '无法解析 LLM 返回的步骤' }, { status: 500 })
    }

    console.log(`[ExecuteDecompose] LLM 返回 ${parsedSteps.length} 个步骤`)

    // 5. assignee 名字 → userId 映射
    function findUserByAgentName(agentName: string): string | null {
      if (!agentName) return null
      const m = members.find(m =>
        (m.user.agent as any)?.name === agentName ||
        (m.user.agent as any)?.name?.includes(agentName) ||
        agentName.includes((m.user.agent as any)?.name || '')
      )
      return m?.user.id ?? null
    }

    // 6. 创建子步骤
    const maxOrder = Math.max(...step.task.steps.map(s => s.order), 0)
    let orderOffset = maxOrder
    const createdSteps = []
    const involvedUserIds = new Set<string>()

    for (const s of parsedSteps) {
      orderOffset++
      const assigneeId = s.assignee ? findUserByAgentName(s.assignee) : null
      if (assigneeId) involvedUserIds.add(assigneeId)

      const created = await prisma.taskStep.create({
        data: {
          title: s.title,
          description: s.description || null,
          order: orderOffset,
          taskId: task.id,
          stepType: s.stepType || 'task',
          assigneeId,
          assigneeNames: s.assignee ? JSON.stringify([s.assignee]) : null,
          requiresApproval: s.requiresApproval !== false,
          parallelGroup: s.parallelGroup || null,
          inputs: s.inputs?.length ? JSON.stringify(s.inputs) : null,
          outputs: s.outputs?.length ? JSON.stringify(s.outputs) : null,
          skills: s.skills?.length ? JSON.stringify(s.skills) : null,
          status: 'pending',
          agentStatus: assigneeId ? 'pending' : null,
        }
      })
      createdSteps.push(created)
    }

    // 7. 将 decompose 步骤标为 done
    const completedAt = new Date()
    await prisma.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'done',
        agentStatus: 'done',
        result: JSON.stringify(parsedSteps),
        summary: `已将任务拆解为 ${createdSteps.length} 个步骤，分配给 ${involvedUserIds.size} 个 Agent`,
        completedAt,
        approvedAt: completedAt,
        agentDurationMs: now ? completedAt.getTime() - now.getTime() : null
      }
    })

    // Agent 状态恢复
    await prisma.agent.updateMany({
      where: { userId: tokenAuth.user.id },
      data: { status: 'online' }
    })

    // 8. 通知相关 Agent
    if (involvedUserIds.size > 0) {
      const userIds = Array.from(involvedUserIds)
      sendToUsers(userIds, { type: 'task:created', taskId: task.id, title: task.title })
      // 通知可以立刻开始的步骤
      const startables = getStartableSteps(createdSteps)
      for (const s of startables) {
        if (s.assigneeId) {
          sendToUser(s.assigneeId, { type: 'step:ready', taskId: task.id, stepId: s.id, title: s.title })
        }
      }
    }
    if (task.creatorId) {
      sendToUser(task.creatorId, { type: 'task:decomposed', taskId: task.id, stepsCount: createdSteps.length })
    }

    console.log(`[ExecuteDecompose] ✅ 完成，创建 ${createdSteps.length} 步，通知 ${involvedUserIds.size} Agent`)

    return NextResponse.json({
      message: `✅ 已拆解为 ${createdSteps.length} 个步骤，通知了 ${involvedUserIds.size} 个 Agent`,
      stepsCreated: createdSteps.length,
      involvedAgents: involvedUserIds.size,
      steps: createdSteps.map(s => ({ id: s.id, title: s.title, assigneeNames: s.assigneeNames, parallelGroup: s.parallelGroup }))
    })

  } catch (error) {
    console.error('[ExecuteDecompose] 失败:', error)
    return NextResponse.json({ error: '执行失败', detail: error instanceof Error ? error.message : '未知错误' }, { status: 500 })
  }
}

function getStartableSteps(steps: any[]): any[] {
  if (steps.length === 0) return []
  const sorted = [...steps].sort((a, b) => a.order - b.order)
  const startable: any[] = []
  const seenGroups = new Set<string>()
  for (const s of sorted) {
    if (!s.parallelGroup) { startable.push(s); break }
    else if (!seenGroups.has(s.parallelGroup)) { seenGroups.add(s.parallelGroup); startable.push(s) }
  }
  return startable.length === 0 ? sorted : startable
}
