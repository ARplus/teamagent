/**
 * 可插拔拆解调度器
 *
 * 根据工作区配置选择拆解方式：
 * - hub-llm（默认）：Hub 内置 LLM（Claude→千问）
 * - main-agent：推给主 Agent，由其本地 LLM 拆解，60s 超时降级到 hub-llm
 */

import { prisma } from '@/lib/db'
import { sendToUser, sendToUsers } from '@/lib/events'
import { getStartableSteps, activateAndNotifySteps } from '@/lib/step-scheduling'
import { parseTaskWithAI } from '@/lib/ai-parse'

// ── 超时计时器注册表（模块级，单进程适用）──
const decomposeTimeouts = new Map<string, NodeJS.Timeout>()

export function cancelDecomposeTimeout(taskId: string): boolean {
  const timer = decomposeTimeouts.get(taskId)
  if (timer) {
    clearTimeout(timer)
    decomposeTimeouts.delete(taskId)
    console.log(`[Decompose] 已取消 taskId=${taskId} 的超时计时器`)
    return true
  }
  return false
}

// ── 工作区成员查询（含 agent 信息）──
async function fetchWorkspaceTeam(workspaceId: string) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: {
      user: {
        select: {
          id: true, name: true, nickname: true,
          agent: { select: { id: true, name: true, capabilities: true, isMainAgent: true, status: true, parentAgentId: true, soul: true, growthLevel: true } }
        }
      }
    }
  })
  return members
}

// ── 构建 teamMembers 上下文数组 ──
function buildTeamContext(members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>) {
  return members
    .filter(m => {
      // 过滤掉子 Agent 用户账号
      const agent = m.user.agent as any
      if (!agent) return true
      if (!agent.parentAgentId) return true
      return false
    })
    .map(m => {
      const agent = m.user.agent as any
      let caps: string[] = []
      if (agent?.capabilities) {
        try { caps = JSON.parse(agent.capabilities) } catch { caps = [] }
      }
      return {
        // 🆕 双身份：人类名 + Agent 名分开，让主 Agent 能正确区分
        humanName: m.user.nickname || m.user.name || '未知',
        name: m.user.nickname || m.user.name || '未知',  // 保持向后兼容
        isAgent: !!agent,
        agentName: agent?.name,
        capabilities: caps,
        role: m.role,
        // 🆕 SOUL 注入：主 Agent 拆解时看到人格摘要和等级
        soulSummary: agent?.soul ? agent.soul.substring(0, 200) : undefined,
        level: agent?.growthLevel || undefined,
      }
    })
}

// ── name → userId 匹配 + Step 创建（从 tasks/route.ts 提取）──
async function createStepsFromParseResult(
  taskId: string,
  steps: any[],
  members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>,
  creatorId: string,
  engine: string,
) {
  // 能力匹配兜底
  function matchByCapabilities(title: string, desc: string): string | null {
    const haystack = `${title} ${desc}`.toLowerCase()
    let best: { userId: string; score: number } | null = null
    for (const m of members) {
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

  const createdSteps: any[] = []
  let order = 0
  for (const step of steps) {
    order++
    let assigneeId: string | null = null
    let resolvedAssigneeType: 'agent' | 'human' = step.assigneeType || 'agent'

    // 支持 assignee（单个名字）和 assignees（数组）两种格式
    const assigneeNames = step.assignees || (step.assignee ? [step.assignee] : [])

    for (const assigneeName of assigneeNames) {
      // 先精确匹配 Agent 名字（如 Lobster、八爪）
      const agentMatch = members.find(m =>
        (m.user.agent as any)?.name === assigneeName
      )
      if (agentMatch) {
        assigneeId = agentMatch.user.id
        if (!step.assigneeType) resolvedAssigneeType = 'agent'
        break
      }
      // 再精确匹配人名（如 Aurora、木须）
      const humanMatch = members.find(m =>
        m.user.nickname === assigneeName || m.user.name === assigneeName
      )
      if (humanMatch) {
        assigneeId = humanMatch.user.id
        // 🆕 Fix: 匹配到人名 → 默认 human（不再因 user 有 Agent 就变 agent）
        if (!step.assigneeType) resolvedAssigneeType = 'human'
        break
      }
      // 模糊匹配 Agent 名字（包含关系）
      const agentFuzzy = members.find(m => {
        const aName = (m.user.agent as any)?.name || ''
        return aName && (aName.includes(assigneeName) || assigneeName.includes(aName))
      })
      if (agentFuzzy) {
        assigneeId = agentFuzzy.user.id
        if (!step.assigneeType) resolvedAssigneeType = 'agent'
        break
      }
      // 最后模糊匹配人名
      const fuzzy = members.find(m =>
        m.user.name?.includes(assigneeName) || assigneeName.includes(m.user.name || '')
      )
      if (fuzzy) {
        assigneeId = fuzzy.user.id
        // 🆕 Fix: 模糊匹配人名 → 默认 human
        if (!step.assigneeType) resolvedAssigneeType = 'human'
        break
      }
    }
    if (!assigneeId) assigneeId = matchByCapabilities(step.title, step.description || '')

    const created = await prisma.taskStep.create({
      data: {
        title: step.title, description: step.description,
        order, taskId, assigneeId,
        assigneeNames: JSON.stringify(assigneeNames),
        inputs: JSON.stringify(step.inputs || []),
        outputs: JSON.stringify(step.outputs || []),
        skills: JSON.stringify(step.skills || []),
        requiresApproval: step.requiresApproval !== false,
        parallelGroup: step.parallelGroup || null,
        status: 'pending', agentStatus: assigneeId ? 'pending' : null,
        stepType: step.stepType || 'task',
        agenda: step.agenda || null,
        participants: (step.participants?.length ?? 0) > 0 ? JSON.stringify(step.participants) : null,
      },
      include: { assignee: { select: { id: true, name: true } } }
    })
    // 同步创建 StepAssignee 记录
    if (assigneeId) {
      await prisma.stepAssignee.create({
        data: { stepId: created.id, userId: assigneeId, isPrimary: true, assigneeType: resolvedAssigneeType }
      }).catch(() => {})
    }
    createdSteps.push(created)
  }

  // 通知所有相关用户 + 激活第一批步骤
  const involvedUserIds = new Set<string>()
  for (const s of createdSteps) if (s.assigneeId) involvedUserIds.add(s.assigneeId)
  if (involvedUserIds.size > 0) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } })
    sendToUsers(Array.from(involvedUserIds), { type: 'task:created', taskId, title: task?.title || '' })
    const startable = getStartableSteps(createdSteps as any[])
    await activateAndNotifySteps(taskId, startable as any[])
  }
  // 通知创建者拆解完成
  sendToUser(creatorId, {
    type: 'task:parsed',
    taskId,
    stepCount: createdSteps.length,
    engine,
  })

  return createdSteps
}

// ── Hub LLM 拆解路径（现有逻辑封装）──
async function executeHubLlmDecompose(
  taskId: string, description: string,
  members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>,
  teamContext: ReturnType<typeof buildTeamContext>,
  creatorId: string,
) {
  const parseResult = await parseTaskWithAI(description, teamContext)
  if (!parseResult.success || !parseResult.steps) {
    console.warn(`[Decompose/Hub] 拆解失败 [engine=${parseResult.engine}]:`, parseResult.error)
    return null
  }
  console.log(`[Decompose/Hub] 拆解成功 [engine=${parseResult.engine}]: ${parseResult.steps.length} 步`)

  const createdSteps = await createStepsFromParseResult(
    taskId, parseResult.steps, members, creatorId, parseResult.engine || 'hub-unknown'
  )

  await prisma.task.update({
    where: { id: taskId },
    data: { decomposeStatus: 'done', decomposeEngine: `hub-${parseResult.engine || 'unknown'}` }
  })

  return createdSteps
}

// ── 超时降级处理 ──
async function handleDecomposeFallback(
  taskId: string, workspaceId: string, description: string, creatorId: string,
) {
  try {
    // 重读状态，防竞态
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { decomposeStatus: true }
    })
    if (!task || task.decomposeStatus !== 'pending') {
      console.log(`[Decompose/Fallback] taskId=${taskId} 状态已变为 ${task?.decomposeStatus}，跳过降级`)
      return
    }

    // 标记为降级中（防止 Agent 晚响应时写入）
    await prisma.task.update({
      where: { id: taskId },
      data: { decomposeStatus: 'fallback' }
    })
    console.log(`[Decompose/Fallback] 主 Agent 60s 未响应，降级到 Hub LLM`)

    const members = await fetchWorkspaceTeam(workspaceId)
    const teamContext = buildTeamContext(members)
    await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId)
  } catch (e: any) {
    console.error(`[Decompose/Fallback] 降级拆解也失败了:`, e?.message)
  } finally {
    decomposeTimeouts.delete(taskId)
  }
}

// ══════════════════════════════════════════
// 主入口：可插拔拆解调度
// ══════════════════════════════════════════
export async function orchestrateDecompose(params: {
  taskId: string
  title: string
  description: string
  supplement?: string | null
  workspaceId: string
  creatorId: string
}): Promise<void> {
  const { taskId, title, description, supplement, workspaceId, creatorId } = params

  // 1. 读取工作区配置
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  })
  let decomposerType = 'hub-llm'
  if (workspace?.settings) {
    try {
      const settings = JSON.parse(workspace.settings)
      if (settings.decomposerType) decomposerType = settings.decomposerType
    } catch { /* settings 解析失败，用默认值 */ }
  }

  // 2. 获取工作区成员
  const members = await fetchWorkspaceTeam(workspaceId)
  const teamContext = buildTeamContext(members)

  console.log(`[Decompose] 任务 "${title}" | 模式=${decomposerType} | 团队 ${teamContext.length} 人`)

  // 3. 路由到具体拆解方式
  if (decomposerType === 'main-agent') {
    // 找到在线的主 Agent
    const mainAgentMember = members.find(m => {
      const agent = m.user.agent as any
      return agent && agent.isMainAgent && !agent.parentAgentId
    })

    if (!mainAgentMember) {
      console.warn(`[Decompose] 工作区无主 Agent，降级到 hub-llm`)
      await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId)
      return
    }

    const mainAgentUserId = mainAgentMember.user.id
    const mainAgentName = (mainAgentMember.user.agent as any)?.name || '主Agent'
    const mainAgentStatus = (mainAgentMember.user.agent as any)?.status || 'offline'

    // 🆕 主 Agent 不在线 → 直接用 hub-llm，不等 60s 超时
    if (mainAgentStatus !== 'online' && mainAgentStatus !== 'working') {
      console.warn(`[Decompose] 主 Agent ${mainAgentName} 不在线(status=${mainAgentStatus})，直接降级到 hub-llm`)
      await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId)
      return
    }

    console.log(`[Decompose] 推送拆解请求给主 Agent: ${mainAgentName} (userId=${mainAgentUserId}, status=${mainAgentStatus})`)

    // 标记任务为 pending
    await prisma.task.update({
      where: { id: taskId },
      data: { decomposeStatus: 'pending' }
    })

    // 发送 SSE 事件给主 Agent
    sendToUser(mainAgentUserId, {
      type: 'task:decompose-request',
      taskId,
      taskTitle: title,
      taskDescription: description,
      supplement: supplement || undefined,
      teamMembers: teamContext,
    })

    // 设置 60s 超时降级
    const timer = setTimeout(() => {
      handleDecomposeFallback(taskId, workspaceId, description, creatorId)
    }, 60000)
    decomposeTimeouts.set(taskId, timer)
    console.log(`[Decompose] 已启动 60s 超时计时器，taskId=${taskId}`)

  } else {
    // hub-llm 默认路径
    console.log(`[Decompose] 使用 Hub LLM 拆解`)
    await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId)
  }
}

// ── 导出 createStepsFromParseResult 给 decompose-result API 使用 ──
export { createStepsFromParseResult, fetchWorkspaceTeam }
