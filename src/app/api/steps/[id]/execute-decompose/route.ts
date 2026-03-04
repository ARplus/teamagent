import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, sendToUsers } from '@/lib/events'
import { getStartableSteps } from '@/lib/step-scheduling'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'
const QWEN_API_KEY = process.env.QWEN_API_KEY || 'sk-4a673b39b21f4e2aad6b9e38f487631f'
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * 调用 LLM（优先 Claude → 降级千问）
 */
async function callDecomposeLLM(systemPrompt: string, userMessage: string): Promise<{ content: string; model: string }> {
  // 优先 Claude（15s 超时，fast fail 降级千问）
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
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          temperature: 0.3,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(t))
      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text
        if (text) return { content: text, model: 'claude-sonnet' }
      }
      console.warn('[ExecuteDecompose] Claude 调用失败，降级到千问')
    } catch (e: any) {
      console.warn('[ExecuteDecompose] Claude 异常，降级到千问:', e.name === 'AbortError' ? '超时(15s)' : e.message)
    }
  }

  // 降级千问（120s 超时，大 prompt 需要时间）
  const ac2 = new AbortController()
  const t2 = setTimeout(() => ac2.abort(), 120_000)
  const res = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen-max-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: ac2.signal,
  }).finally(() => clearTimeout(t2))

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`千问 API 失败 (${res.status}): ${err}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('千问无返回内容')
  return { content: text, model: 'qwen-max' }
}

/**
 * POST /api/steps/[id]/execute-decompose
 *
 * 主 Agent 专用：一键执行 decompose 步骤
 *   1. 验证是主 Agent 本人调用
 *   2. 获取任务描述 + 工作区完整团队（人类+Agent+归属链）
 *   3. 调用 LLM（Claude优先）生成步骤 JSON
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
            creator: { select: { id: true, name: true, nickname: true } },
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

    // 2. 获取工作区完整团队（人类 + Agent + 归属链 + 能力）
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: task.workspaceId },
      include: {
        user: {
          select: {
            id: true, name: true, nickname: true,
            agent: {
              select: {
                name: true, capabilities: true, isMainAgent: true, status: true,
                childAgents: { select: { name: true, capabilities: true, status: true, user: { select: { id: true, name: true } } } }
              }
            }
          }
        }
      }
    })

    // 3. 构建增强版团队描述（包含人类 + 归属链）
    const creatorName = task.creator?.nickname || task.creator?.name || '未知'
    const teamLines: string[] = []

    for (const m of members) {
      const user = m.user
      const agent = user.agent as any
      const humanName = user.nickname || user.name || '未知'
      const isCreator = user.id === task.creatorId

      if (agent && agent.isMainAgent) {
        // 人类 + 主Agent + 子Agent 组
        let caps: string[] = []
        try { caps = JSON.parse(agent.capabilities || '[]') } catch {}
        teamLines.push(`👤 ${humanName}${isCreator ? '（任务发起者）' : '（协作伙伴）'}`)
        teamLines.push(`├─ 🤖 ${agent.name}（主Agent）: ${caps.length > 0 ? caps.join('、') : '通用'}  ${agent.status === 'online' ? '🟢在线' : '🔴离线'}`)

        // 子 Agent
        const children = agent.childAgents || []
        for (let i = 0; i < children.length; i++) {
          const child = children[i]
          let childCaps: string[] = []
          try { childCaps = JSON.parse(child.capabilities || '[]') } catch {}
          const prefix = i === children.length - 1 ? '└─' : '├─'
          teamLines.push(`│  ${prefix} ⚙️ ${child.name}: ${childCaps.length > 0 ? childCaps.join('、') : '通用'}  ${child.status === 'online' ? '🟢在线' : '🔴离线'}`)
        }
      } else if (!agent) {
        // 纯人类成员（无 Agent）
        teamLines.push(`👤 ${humanName}${isCreator ? '（任务发起者）' : '（协作伙伴，无Agent）'}`)
        teamLines.push(`└─ 可分配纯人类步骤（需手动完成）`)
      }
      // 子Agent 的 user 条目（由主Agent注册的虚拟用户）跳过，已在主Agent下展示
    }

    const teamDesc = teamLines.join('\n')

    // 4. 构建拆解 Prompt（增强版：支持人类步骤 + 归属链）
    const systemPrompt = `你是 TeamAgent 的主 Agent，负责将任务拆解为最优执行方案。

## 工作区协作网络（可分配的人员池）
${teamDesc || '（暂无团队成员，步骤分配给主 Agent 自己）'}

## 输出格式（JSON 数组）
[
  {
    "title": "步骤标题",
    "description": "详细说明",
    "assignee": "成员名字",
    "assigneeType": "agent 或 human",
    "requiresApproval": true,
    "parallelGroup": null,
    "inputs": ["依赖的输入"],
    "outputs": ["产出物"],
    "skills": ["需要的技能"]
  }
]

## 拆解规则
1. assignee 必须是上面列出的成员之一（Agent 用 Agent 名字，人类用人名）
2. assigneeType: "agent"（由 Agent 执行）或 "human"（纯人类步骤，需要人类亲自完成）
3. 根据成员能力匹配最合适的 assignee
4. 优先分配给 🟢在线 的成员
5. 需要人类决策、审核、签字等的步骤 → 分配给人类，assigneeType 设为 "human"
6. 可并行的步骤设相同的 parallelGroup 字符串（如 "调研"、"开发"）
7. 顺序执行的步骤 parallelGroup 设为 null
8. 需要质量把控的步骤，requiresApproval 设为 true
9. 中间过渡步骤或无需审查的 requiresApproval 设为 false
10. 最少 2 步，最多 8 步
11. **禁止 meta 步骤**：Agent 只能执行具体工作，不能"安排别人"。"安排 N 个 Agent 测试"→ 你直接选 N 个 Agent 各创建一步；"让 XX 安排 YY"→ 直接给 YY 创建步骤
12. **步骤标题必须是动作短语**：如"提交个人Slogan"、"撰写报告"。⛔ 绝不能把成员的个人简介/座右铭/描述当标题

只输出 JSON 数组，不要其他内容。`

    const userMessage = `请根据团队成员的能力和角色，将以下任务拆解为步骤：\n\n任务标题：${task.title}\n\n${task.description}`

    // 5. 调用 LLM（Claude 优先 → 千问降级）
    console.log(`[ExecuteDecompose] 调用 LLM 拆解任务: ${task.title}`)
    const llmResult = await callDecomposeLLM(systemPrompt, userMessage)
    console.log(`[ExecuteDecompose] 使用模型: ${llmResult.model}`)

    // 解析 JSON（可能是数组或包含 steps 字段的对象）
    let parsedSteps: any[]
    try {
      // 去除可能的 markdown 代码块包裹
      let rawContent = llmResult.content.trim()
      if (rawContent.startsWith('```')) {
        rawContent = rawContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const parsed = JSON.parse(rawContent)
      parsedSteps = Array.isArray(parsed) ? parsed : (parsed.steps ?? [])
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) throw new Error('空数组')
    } catch {
      console.error('[ExecuteDecompose] JSON 解析失败:', llmResult.content.substring(0, 300))
      return NextResponse.json({ error: '无法解析 LLM 返回的步骤' }, { status: 500 })
    }

    console.log(`[ExecuteDecompose] LLM 返回 ${parsedSteps.length} 个步骤`)

    // 6. assignee 名字 → userId 映射（支持 Agent 名字和人类名字）
    function findUserByName(name: string): string | null {
      if (!name) return null
      // 先找 Agent 名字匹配
      const agentMatch = members.find(m => {
        const a = m.user.agent as any
        if (!a) return false
        return a.name === name || a.name?.includes(name) || name.includes(a.name || '')
      })
      if (agentMatch) return agentMatch.user.id

      // 再找子 Agent 名字匹配（子Agent 的 user 也是 member）
      for (const m of members) {
        const a = m.user.agent as any
        if (!a?.childAgents) continue
        for (const child of a.childAgents) {
          if (child.name === name || child.name?.includes(name) || name.includes(child.name || '')) {
            return child.user?.id ?? null
          }
        }
      }

      // 最后找人类名字匹配
      const humanMatch = members.find(m =>
        m.user.name === name || m.user.nickname === name ||
        (m.user.name && name.includes(m.user.name)) ||
        (m.user.nickname && name.includes(m.user.nickname))
      )
      return humanMatch?.user.id ?? null
    }

    // 7. 创建子步骤
    const maxOrder = Math.max(...step.task.steps.map(s => s.order), 0)
    let orderOffset = maxOrder
    const createdSteps = []
    const involvedUserIds = new Set<string>()

    for (const s of parsedSteps) {
      orderOffset++
      const assigneeId = s.assignee ? findUserByName(s.assignee) : null
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
          // assigneeType lives on StepAssignee, not TaskStep
          status: 'pending',
          agentStatus: assigneeId ? 'pending' : null,
        }
      })
      // B08: 同步创建 StepAssignee 记录
      if (assigneeId) {
        await prisma.stepAssignee.create({
          data: {
            stepId: created.id,
            userId: assigneeId,
            isPrimary: true,
            assigneeType: s.assigneeType || 'agent'
          }
        }).catch(() => {})
      }
      createdSteps.push(created)
    }

    // 8. 将 decompose 步骤标为 done
    const completedAt = new Date()
    await prisma.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'done',
        agentStatus: 'done',
        result: JSON.stringify(parsedSteps),
        summary: `已将任务拆解为 ${createdSteps.length} 个步骤，分配给 ${involvedUserIds.size} 个成员（${llmResult.model}）`,
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

    // 9. 通知相关成员
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

    console.log(`[ExecuteDecompose] ✅ 完成 (${llmResult.model})，创建 ${createdSteps.length} 步，通知 ${involvedUserIds.size} 成员`)

    return NextResponse.json({
      message: `✅ 已拆解为 ${createdSteps.length} 个步骤，通知了 ${involvedUserIds.size} 个成员`,
      stepsCreated: createdSteps.length,
      involvedAgents: involvedUserIds.size,
      model: llmResult.model,
      steps: createdSteps.map(s => ({ id: s.id, title: s.title, assigneeNames: s.assigneeNames, parallelGroup: s.parallelGroup }))
    })

  } catch (error) {
    console.error('[ExecuteDecompose] 失败:', error)
    return NextResponse.json({ error: '执行失败', detail: error instanceof Error ? error.message : '未知错误' }, { status: 500 })
  }
}

// getStartableSteps 已移至 @/lib/step-scheduling 共享模块
