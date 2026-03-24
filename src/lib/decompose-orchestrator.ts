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
import { buildDecomposePrompt, SOLO_EXECUTION_PROTOCOL, TEAM_EXECUTION_PROTOCOL } from '@/lib/decompose-prompt'
import { createNotification, notificationTemplates } from '@/lib/notifications'

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
// includeSubAgentsForCreatorId: 若指定，额外把该创建者的子 Agent 加入列表（标 isSubAgent=true）
// 用于方式B主Agent自行拆解时，让主Agent知道自己的影子军团可分配
function buildTeamContext(
  members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>,
  creatorOnlyId?: string,
  includeSubAgentsForCreatorId?: string,
) {
  function mapMember(m: Awaited<ReturnType<typeof fetchWorkspaceTeam>>[0], isSubAgent = false) {
    const agent = m.user.agent as any
    let caps: string[] = []
    if (agent?.capabilities) {
      try { caps = JSON.parse(agent.capabilities) } catch { caps = [] }
    }
    return {
      humanName: m.user.name || m.user.nickname || '未知',
      name: m.user.name || m.user.nickname || '未知',
      isAgent: !!agent,
      agentName: agent?.name,
      capabilities: caps,
      role: m.role,
      soulSummary: agent?.soul ? agent.soul.substring(0, 200) : undefined,
      level: agent?.growthLevel || undefined,
      ...(isSubAgent ? { isSubAgent: true } : {}),
    }
  }

  const mainList = members
    .filter(m => {
      const agent = m.user.agent as any
      if (agent?.parentAgentId) return false  // 过滤掉子 Agent 用户账号
      if (creatorOnlyId && m.user.id !== creatorOnlyId) return false
      return true
    })
    .map(m => mapMember(m))

  if (!includeSubAgentsForCreatorId) return mainList

  // 找创建者的主 Agent ID，再找其子 Agent
  const creatorMainAgentId = (() => {
    const cm = members.find(m => m.user.id === includeSubAgentsForCreatorId && !!(m.user.agent as any) && !(m.user.agent as any)?.parentAgentId)
    return (cm?.user.agent as any)?.id as string | undefined
  })()

  if (!creatorMainAgentId) return mainList

  const subList = members
    .filter(m => (m.user.agent as any)?.parentAgentId === creatorMainAgentId)
    .map(m => mapMember(m, true))

  if (subList.length > 0) {
    console.log(`[Decompose] 已附加创建者子 Agent ${subList.length} 个到拆解上下文: ${subList.map(s => s.agentName).join(', ')}`)
  }

  return [...mainList, ...subList]
}

// ── name → userId 匹配 + Step 创建（从 tasks/route.ts 提取）──
// autoActivate: true = 激活步骤+触发 Agent 自动执行（主 Agent 拆解时用）
//               false = 只创建步骤，不激活，等人类审核（千问 fallback 时用）
async function createStepsFromParseResult(
  taskId: string,
  steps: any[],
  members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>,
  creatorId: string,
  engine: string,
  autoActivate: boolean = true,
  mode: 'solo' | 'team' = 'team',
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

  // ── Solo 模式：预计算允许的 userId 集合（创建者 + 创建者的子 Agent）──
  let soloAllowedUserIds: Set<string> | null = null
  let soloCreatorMainAgentUserId: string | null = null
  if (mode === 'solo') {
    soloAllowedUserIds = new Set<string>()
    soloAllowedUserIds.add(creatorId) // 创建者自己（人类 or Agent）
    // 找创建者的子 Agent 用户
    for (const m of members) {
      const agent = m.user.agent as any
      if (!agent) continue
      if (agent.parentAgentId) {
        // 子 Agent：检查 parent 是否属于创建者
        const parentMember = members.find(pm => {
          const pa = pm.user.agent as any
          return pa && pa.id === agent.parentAgentId && pm.user.id === creatorId
        })
        if (parentMember) soloAllowedUserIds!.add(m.user.id)
      }
      if (m.user.id === creatorId && agent.isMainAgent) {
        soloCreatorMainAgentUserId = m.user.id
      }
    }
    console.log(`[Decompose/Solo] 允许的 userId: ${Array.from(soloAllowedUserIds).join(', ')}`)
  }

  // ⛔ 后处理过滤：删除分配给主 Agent 的汇总/整合/收尾类步骤（系统自动生成总结，无需此步骤）
  const SUMMARY_KEYWORDS = /汇总|整合|汇报|收尾|最终.*确认|总结|final.*summary|summary/i
  const filteredSteps = steps.filter((step: any) => {
    const title = step.title || ''
    const assigneeNames: string[] = Array.isArray(step.assignees) ? step.assignees : (step.assignee ? [step.assignee] : [])
    // 判断是否分配给主 Agent（非子 Agent，非人类）
    const isMainAgent = assigneeNames.some((name: string) => {
      const m = members.find(m2 => {
        const a = m2.user.agent as any
        return a && (a.name === name || m2.user.name === name || m2.user.nickname === name)
      })
      if (!m) return false
      const a = m.user.agent as any
      return a && !a.parentAgentId // 主 Agent = 有 agent 且无 parentAgentId
    })
    if (isMainAgent && SUMMARY_KEYWORDS.test(title)) {
      console.log(`[Decompose/Filter] ⛔ 删除主 Agent 汇总步骤:「${title}」`)
      return false
    }
    return true
  })
  if (filteredSteps.length !== steps.length) {
    console.log(`[Decompose/Filter] 过滤后 ${filteredSteps.length}/${steps.length} 步骤保留`)
  }

  const createdSteps: any[] = []
  let order = 0
  for (const step of filteredSteps) {
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

    // 🆕 兜底：能力匹配也失败 → 回退到创建者的主 Agent（或工作区任意主 Agent）
    let fallbackToMain = false
    if (!assigneeId) {
      const mainAgentMember =
        members.find(m => {
          const a = m.user.agent as any
          return a && a.isMainAgent && !a.parentAgentId && m.user.id === creatorId
        }) ||
        members.find(m => {
          const a = m.user.agent as any
          return a && a.isMainAgent && !a.parentAgentId
        })
      if (mainAgentMember) {
        assigneeId = mainAgentMember.user.id
        resolvedAssigneeType = 'agent'
        fallbackToMain = true
        const originalAssignee = assigneeNames[0] || '未知'
        const mainAgentName = (mainAgentMember.user.agent as any)?.name || mainAgentMember.user.name || mainAgentMember.user.nickname || '主 Agent'
        // 在描述末尾追加兜底说明，让 Agent 知情
        step.description = ((step.description || '') + `\n\n⚠️ 自动兜底：此步骤指定「${originalAssignee}」但未找到匹配成员，已分配给「${mainAgentName}」。执行前请确认是否合适，如不合适请说明并等待人工重新分配。`).trim()
        console.log(`[Decompose] 步骤「${step.title}」无匹配成员，兜底 → ${mainAgentName}`)
      }
    }

    // 🆕 Fix: 只存匹配到真实成员的名字，防止千问幻觉名字（如"探索星辰大海"）显示在 UI
    const resolvedName = assigneeId
      ? (() => {
          const m = members.find(m2 => m2.user.id === assigneeId)
          if (!m) return assigneeNames
          const agentName = (m.user.agent as any)?.name
          return agentName ? [agentName] : [m.user.name || m.user.nickname || assigneeNames[0]]
        })()
      : []

    // 未分配标记：assigneeId 为空时高亮显示
    const isUnassigned = !assigneeId
    const unassignedReason = isUnassigned
      ? (assigneeNames.length > 0 ? `拆解指定「${assigneeNames[0]}」但未匹配到成员` : '拆解未指定执行者')
      : null

    // ── Solo 模式：强制校验 assigneeId 是否在允许范围内 ──
    if (mode === 'solo' && soloAllowedUserIds && assigneeId && !soloAllowedUserIds.has(assigneeId)) {
      const violatedName = assigneeNames[0] || '未知'
      const reassignTarget = soloCreatorMainAgentUserId || creatorId
      console.warn(`[Decompose/Solo] ⛔ 步骤「${step.title}」违反 Solo 规则：assignee="${violatedName}" (userId=${assigneeId}) 不在允许范围内，强制重分配给创建者 (userId=${reassignTarget})`)
      assigneeId = reassignTarget
      resolvedAssigneeType = 'agent'
      step.description = ((step.description || '') + `\n\n⚠️ Solo 模式自动修正：此步骤原分配给「${violatedName}」，但 Solo 任务不允许分配给其他成员，已自动重分配给你。`).trim()
    }

    // ── 步骤类型后处理（兜底铁律，防 LLM 打标错误）──
    const stepText = `${step.title || ''} ${step.description || ''}`.toLowerCase()

    // 铁律1：人类决策/不可逆操作 → 强制 waiting_human
    // 包含两类：①不可逆操作（下单/支付等）；②人类选择决策（从清单选/确认选品等）
    // ⚠️ 注意：调研/推荐/挑选步骤不在此列——那是 Agent 该做的事，应由 LLM 拆成"执行+确认"两步
    const isIrreversibleStep = /下单|支付|付款|转账|发布上线|删除|授权|提交.*订单|确认.*购买|安排快递|寄出|确认选品|确认选择|从.*中选|人工确认|亲自选|自行选/.test(stepText)
      && !/调研|搜索|整理|推荐|挑选|筛选/.test(stepText) // 排除含调研性质的步骤
    if (isIrreversibleStep && resolvedAssigneeType !== 'human') {
      console.log(`[Decompose/PostProcess] 步骤「${step.title}」含不可逆操作 → 强制 waiting_human`)
      resolvedAssigneeType = 'human'
      assigneeId = creatorId
      step.stepType = 'waiting_human'
      step.requiresApproval = false
    }

    // 写作/创作类 Agent 步骤 → requiresApproval = true（需人类审核内容）
    const isCreativeStep = /撰写|写作|创作|起草|撰稿|生成文案|写.*卡片|写.*文章|写.*报告/.test(stepText)
    if (isCreativeStep && resolvedAssigneeType === 'agent') {
      step.requiresApproval = true
      console.log(`[Decompose/PostProcess] 步骤「${step.title}」含写作关键词 → requiresApproval=true`)
    }

    // 调研/搜索/推荐类步骤被 LLM 误标为 human/waiting_human → 纠正为 agent + requiresApproval
    // 根因：LLM 误读铁律2，把"调研推荐产品"这种 Agent 该做的步骤也标成了 waiting_human
    // ⚠️ 例外：LLM 同时明确写了 assigneeType="human" + stepType="waiting_human" 时，信任 LLM，不覆盖
    const isResearchMislabeled = /调研|搜索|推荐|查找|挑选|筛选/.test(stepText)
      && (resolvedAssigneeType === 'human' || step.stepType === 'waiting_human')
      && !/下单|支付|付款|确认.*购买|亲自|手动|本人/.test(stepText)
      && !(step.assigneeType === 'human' && step.stepType === 'waiting_human') // LLM 明确双标记时，不纠正
    if (isResearchMislabeled) {
      console.log(`[Decompose/PostProcess] 步骤「${step.title}」调研类被误标 human → 纠正 agent+requiresApproval=true`)
      resolvedAssigneeType = 'agent'
      step.stepType = 'task'
      step.requiresApproval = true
      // 若当前 assigneeId 没有 agent（纯人类账号），换成创建者的主 Agent
      const hasAgent = assigneeId
        ? members.some(m => m.user.id === assigneeId && !!(m.user.agent as any))
        : false
      if (!hasAgent) {
        const mainAgent = members.find(m => {
          const a = m.user.agent as any
          return a && a.isMainAgent && !a.parentAgentId && m.user.id === creatorId
        }) || members.find(m => {
          const a = m.user.agent as any
          return a && a.isMainAgent && !a.parentAgentId
        })
        if (mainAgent) assigneeId = mainAgent.user.id
      }
    }

    // 按任务模式注入对应硬指令到 Agent 步骤
    const isHumanStep = resolvedAssigneeType === 'human'
    const protocol = mode === 'team' ? TEAM_EXECUTION_PROTOCOL : SOLO_EXECUTION_PROTOCOL
    let finalDesc = step.description || null
    if (!isHumanStep) {
      finalDesc = finalDesc
        ? `${protocol}\n\n---\n\n## 本步骤任务\n\n${finalDesc}`
        : protocol
    }

    const created = await prisma.taskStep.create({
      data: {
        title: step.title, description: finalDesc,
        order, taskId, assigneeId,
        assigneeNames: resolvedName.length > 0 ? JSON.stringify(resolvedName) : null,
        inputs: JSON.stringify(step.inputs || []),
        outputs: JSON.stringify(step.outputs || []),
        skills: JSON.stringify(step.skills || []),
        requiresApproval: step.requiresApproval !== false,
        parallelGroup: step.parallelGroup || null,
        // agentStatus 初始为 null，只有 activateAndNotifySteps 激活后才变为 'pending'
        // 这样 SSE 重连补发时不会把未激活的步骤也推出去（并发执行 bug 根治）
        status: 'pending', agentStatus: null,
        stepType: step.stepType || 'task',
        agenda: step.agenda || null,
        participants: (step.participants?.length ?? 0) > 0 ? JSON.stringify(step.participants) : null,
        unassigned: isUnassigned,
        unassignedReason,
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

    // 兜底分配时通知创建者
    if (fallbackToMain && creatorId) {
      const mainAgentName = assigneeId
        ? (() => {
            const m = members.find(m2 => m2.user.id === assigneeId)
            return (m?.user.agent as any)?.name || m?.user.name || m?.user.nickname || '主 Agent'
          })()
        : '主 Agent'
      createNotification({
        userId: creatorId,
        type: 'task_assigned',
        title: `⚠️ 步骤「${step.title}」兜底分配`,
        content: `指定的执行者「${assigneeNames[0] || '未知'}」未找到，已自动分配给「${mainAgentName}」，请确认是否合适。`,
        taskId,
        stepId: created.id,
      }).catch(() => {})
    }
  }

  // 通知相关用户
  const involvedUserIds = new Set<string>()
  for (const s of createdSteps) if (s.assigneeId) involvedUserIds.add(s.assigneeId)

  if (autoActivate) {
    // 主 Agent 拆解：激活步骤 + 触发 Agent 自动执行
    if (involvedUserIds.size > 0) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } })
      sendToUsers(Array.from(involvedUserIds), { type: 'task:created', taskId, title: task?.title || '' })
      const startable = getStartableSteps(createdSteps as any[])
      console.log(`[Decompose] 激活首批步骤: ${startable.length} 个 → ${startable.map(s => `"${s.title}"(assignee=${s.assigneeId})`).join(', ')}`)
      const notified = await activateAndNotifySteps(taskId, startable as any[])
      console.log(`[Decompose] 已通知 ${notified} 个步骤的负责人`)
    } else {
      console.warn(`[Decompose] ⚠️ 所有步骤都没有 assigneeId，无法激活`)
    }
  } else {
    // 千问 fallback：只通知创建者有新步骤，不激活、不自动执行
    console.log(`[Decompose] 千问 fallback 模式：${createdSteps.length} 个步骤已创建，等待人工审核后激活`)
  }

  // 通知创建者拆解完成
  sendToUser(creatorId, {
    type: 'task:parsed',
    taskId,
    stepCount: createdSteps.length,
    engine,
    autoActivated: autoActivate,
  } as any)

  // P2-3: 拆解后自动在频道 @被分配的队友
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, workspaceId: true }
    })
    if (task?.workspaceId) {
      const { ensureDefaultChannel } = await import('./channel-utils')
      const channel = await ensureDefaultChannel(task.workspaceId)
      if (channel) {
        // 构建 @mention 列表
        const mentionNames: string[] = []
        for (const s of createdSteps) {
          if (s.assignee?.name && !mentionNames.includes(s.assignee.name)) {
            mentionNames.push(s.assignee.name)
          }
        }
        const mentions = mentionNames.map(n => `@${n}`).join(' ')
        const stepSummary = createdSteps.map((s, i) =>
          `${i + 1}. ${s.title} → ${s.assignee?.name || '待分配'}`
        ).join('\n')

        const msg = `📋 任务「${task.title}」已拆解为 ${createdSteps.length} 个步骤：\n${stepSummary}\n\n${mentions} 请查看各自的步骤！`

        await prisma.channelMessage.create({
          data: {
            channelId: channel.id,
            senderId: creatorId,
            content: msg,
          }
        })
        console.log(`[Decompose] 已在 #${channel.name} 通知 ${mentionNames.length} 位队友`)
      }
    }
  } catch (e: any) {
    console.warn('[Decompose] 频道通知失败（非关键）:', e?.message)
  }

  return createdSteps
}

// ── Hub LLM 拆解路径（现有逻辑封装）──
// autoActivate: 是否激活步骤（主动调用时 true，fallback 降级时 false）
async function executeHubLlmDecompose(
  taskId: string, description: string,
  members: Awaited<ReturnType<typeof fetchWorkspaceTeam>>,
  teamContext: ReturnType<typeof buildTeamContext>,
  creatorId: string,
  autoActivate: boolean = true,
  mode: 'solo' | 'team' = 'team',
) {
  const parseResult = await parseTaskWithAI(description, teamContext)
  if (!parseResult.success || !parseResult.steps) {
    console.warn(`[Decompose/Hub] 拆解失败 [engine=${parseResult.engine}]:`, parseResult.error)
    return null
  }
  console.log(`[Decompose/Hub] 拆解成功 [engine=${parseResult.engine}]: ${parseResult.steps.length} 步 | autoActivate=${autoActivate} | mode=${mode}`)

  const createdSteps = await createStepsFromParseResult(
    taskId, parseResult.steps, members, creatorId, parseResult.engine || 'hub-unknown', autoActivate, mode
  )

  await prisma.task.update({
    where: { id: taskId },
    data: { decomposeStatus: 'done', decomposeEngine: `hub-${parseResult.engine || 'unknown'}` }
  })

  return createdSteps
}

// ── 超时降级处理 ──
async function handleDecomposeFallback(
  taskId: string, workspaceId: string, description: string, creatorId: string, mode: 'solo' | 'team' = 'team',
) {
  try {
    // 重读状态，防竞态
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { decomposeStatus: true }
    })
    if (!task || (task.decomposeStatus !== 'pending' && task.decomposeStatus !== 'processing')) {
      console.log(`[Decompose/Fallback] taskId=${taskId} 状态已变为 ${task?.decomposeStatus}，跳过降级`)
      return
    }

    // 重置回 pending，等 Watch 重连时重新下发（千问 fallback 已移除）
    await prisma.task.update({
      where: { id: taskId },
      data: { decomposeStatus: 'pending' }
    })
    console.log(`[Decompose/Fallback] taskId=${taskId} 超时未回写，重置为 pending，等 Agent 重连重试`)
    // ⚠️ 千问 fallback 已移除，不再调用 hub-llm，直接等 Agent 重连后重试
    return
  } catch (e: any) {
    console.error(`[Decompose/Fallback] 降级拆解也失败了:`, e?.message)
  } finally {
    decomposeTimeouts.delete(taskId)
  }
}

// ══════════════════════════════════════════
// 主入口：可插拔拆解调度
// ══════════════════════════════════════════
const BYOA_AGENT_TIMEOUT_MS  = 3 * 60 * 1000   // 3min：等 Agent 响应
const BYOA_BROADCAST_WAIT_MS = 2 * 60 * 1000   // 再 2min：广播后等其他 Agent 接单

export async function orchestrateDecompose(params: {
  taskId: string
  title: string
  description: string
  supplement?: string | null
  workspaceId: string
  creatorId: string
  mode?: 'solo' | 'team'
}): Promise<void> {
  const { taskId, title, description, supplement, workspaceId, creatorId, mode = 'team' } = params

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
  // Solo 模式：只包含创建者自己（人类+Agent），不暴露工作区其他成员
  const teamContext = buildTeamContext(members, mode === 'solo' ? creatorId : undefined)

  console.log(`[Decompose] 任务 "${title}" | 模式=${decomposerType} | mode=${mode} | 团队 ${teamContext.length} 人`)

  // 3. 路由到具体拆解方式
  if (decomposerType === 'main-agent') {
    // 只用创建者自己的主 Agent 拆解，不能让别人的 Agent 代劳
    const allMainAgents = members.filter(m => {
      const agent = m.user.agent as any
      return agent && agent.isMainAgent && !agent.parentAgentId
    })
    const mainAgentMember = allMainAgents.find(m => m.user.id === creatorId)

    if (!mainAgentMember) {
      console.warn(`[Decompose] 创建者无主 Agent，降级到 hub-llm（不自动执行）`)
      await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId, false, mode)
      return
    }

    const mainAgentUserId = mainAgentMember.user.id
    const mainAgentName = (mainAgentMember.user.agent as any)?.name || '主Agent'
    const mainAgentStatus = (mainAgentMember.user.agent as any)?.status || 'offline'

    // 标记任务为 pending（等待 Agent）
    await prisma.task.update({
      where: { id: taskId },
      data: { decomposeStatus: 'pending' }
    })

    // 构建填充好的拆解 prompt，随事件发出
    // 方式B：主Agent自行拆解 — prompt 包含其子 Agent 列表，让主Agent知道影子军团可分配
    const teamContextWithSubs = buildTeamContext(members, mode === 'solo' ? creatorId : undefined, creatorId)
    let filledPrompt: string | undefined
    try {
      filledPrompt = await buildDecomposePrompt(workspaceId, {
        taskTitle: title,
        taskDescription: description,
        supplement: supplement || undefined,
        teamMembers: teamContextWithSubs,
      })
    } catch (e) {
      console.warn('[Decompose] 构建 decomposePrompt 失败，Agent 将使用本地 fallback:', e)
    }

    // BYOA 超时策略：先创建 timer 再推 SSE，防止 ACK 到达时 timer 还不存在（竞态条件）
    // 3min 无响应 → Solo通知/Team广播，Team再2min无人接 → 通知失败
    const timer = setTimeout(async () => {
      // 检查是否已经有人开始拆解
      const current = await prisma.task.findUnique({
        where: { id: taskId }, select: { decomposeStatus: true, title: true }
      })
      if (!current || current.decomposeStatus !== 'pending') {
        decomposeTimeouts.delete(taskId)
        return // 已有 Agent 处理，不干预
      }

      if (mode === 'solo') {
        // Solo：私密任务，只通知创建者唤醒 Agent
        console.warn(`[Decompose] Solo 任务 3min 无响应，通知创建者唤醒 Agent`)
        sendToUser(creatorId, {
          type: 'task:waiting-agent',
          taskId, taskTitle: title, agentName: mainAgentName, mode: 'solo',
        })
        createNotification({
          userId: creatorId,
          ...notificationTemplates.taskWaitingAgent(title, mainAgentName),
          taskId,
        }).catch(() => {})
        decomposeTimeouts.delete(taskId)
      } else {
        // Team：广播给工作区所有在线 Agent，等 2min 看有没有人接
        console.warn(`[Decompose] Team 任务 3min 无响应，广播给工作区所有 Agent`)

        // 找到工作区所有 Agent 用户（排除创建者自己的主 Agent）
        const broadcastTargets = members
          .filter(m => {
            const agent = m.user.agent as any
            return agent && !agent.parentAgentId &&
              (agent.status === 'online' || agent.status === 'working') &&
              m.user.id !== mainAgentUserId
          })
          .map(m => m.user.id)

        if (broadcastTargets.length > 0) {
          // 找到 decompose 步骤，将 assigneeId 置为 null（开放接单）
          const decomposeStep = await prisma.taskStep.findFirst({
            where: { taskId, stepType: 'decompose' }, select: { id: true }
          })
          if (decomposeStep) {
            await prisma.taskStep.update({
              where: { id: decomposeStep.id },
              data: { assigneeId: null }
            })
            // 广播事件
            sendToUsers(broadcastTargets, {
              type: 'task:decompose-available',
              taskId, stepId: decomposeStep.id,
              taskTitle: title, taskDescription: description,
              supplement: supplement || undefined,
              teamMembers: teamContext,
              ...(filledPrompt ? { decomposePrompt: filledPrompt } : {}),
            })
            // 通知创建者：广播中
            sendToUser(creatorId, {
              type: 'task:waiting-agent',
              taskId, taskTitle: title, agentName: mainAgentName, mode: 'team',
            })
            createNotification({
              userId: creatorId,
              ...notificationTemplates.taskWaitingAgent(title, mainAgentName),
              taskId,
            }).catch(() => {})
          }

          // 再等 2min，还没人接 → 通知失败
          const broadcastTimer = setTimeout(async () => {
            const latest = await prisma.task.findUnique({
              where: { id: taskId }, select: { decomposeStatus: true }
            })
            if (latest?.decomposeStatus === 'pending') {
              console.warn(`[Decompose] Team 广播 2min 无人接单，通知失败`)
              sendToUser(creatorId, {
                type: 'task:decompose-failed',
                taskId, taskTitle: title,
                reason: '5分钟内工作区内没有 Agent 接单，请唤醒你的 Agent 后重试',
              })
              createNotification({
                userId: creatorId,
                ...notificationTemplates.taskDecomposeFailed(title),
                taskId,
              }).catch(() => {})
            }
            decomposeTimeouts.delete(taskId)
          }, BYOA_BROADCAST_WAIT_MS)
          decomposeTimeouts.set(taskId, broadcastTimer)
        } else {
          // 工作区没有其他在线 Agent → 直接通知失败
          sendToUser(creatorId, {
            type: 'task:decompose-failed',
            taskId, taskTitle: title,
            reason: '工作区内没有在线 Agent，请唤醒你的 Agent 后重试',
          })
          createNotification({
            userId: creatorId,
            ...notificationTemplates.taskDecomposeFailed(title),
            taskId,
          }).catch(() => {})
          decomposeTimeouts.delete(taskId)
        }
      }
    }, BYOA_AGENT_TIMEOUT_MS)
    decomposeTimeouts.set(taskId, timer)

    // Timer 已就绪，现在安全推送 SSE（ACK 到达时 timer 一定存在）
    console.log(`[Decompose] 推送拆解请求给主 Agent: ${mainAgentName} (userId=${mainAgentUserId}, status=${mainAgentStatus})`)
    sendToUser(mainAgentUserId, {
      type: 'task:decompose-request',
      taskId, taskTitle: title, taskDescription: description,
      mode, // solo or team — Agent 用于决定 assignee 范围
      supplement: supplement || undefined,
      teamMembers: teamContextWithSubs,  // 包含创建者子 Agent（方式B）
      ...(filledPrompt ? { decomposePrompt: filledPrompt } : {}),
    })

    if (mainAgentStatus !== 'online' && mainAgentStatus !== 'working') {
      console.warn(`[Decompose] 主 Agent ${mainAgentName} DB状态=${mainAgentStatus}，额外通知创建者`)
      sendToUser(creatorId, {
        type: 'task:waiting-agent',
        taskId, taskTitle: title, agentName: mainAgentName, mode,
      })
      createNotification({
        userId: creatorId,
        ...notificationTemplates.taskWaitingAgent(title, mainAgentName),
        taskId,
      }).catch(() => {})
    }

    console.log(`[Decompose] BYOA 模式已启动，taskId=${taskId}, mode=${mode}`)

  } else {
    // hub-llm 默认路径
    console.log(`[Decompose] 使用 Hub LLM 拆解 (mode=${mode})`)
    await executeHubLlmDecompose(taskId, description, members, teamContext, creatorId, true, mode)
  }
}

// ── 导出 createStepsFromParseResult 给 decompose-result API 使用 ──
export { createStepsFromParseResult, fetchWorkspaceTeam }
