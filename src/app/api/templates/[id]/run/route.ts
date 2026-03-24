import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { createNotification } from '@/lib/notifications'
import { getStartableSteps, activateAndNotifySteps } from '@/lib/step-scheduling'
import {
  getBuiltinVariables,
  validateVariables,
  resolveVariables,
  instantiateSteps,
  type VariableDefinition,
  type StepTemplate,
} from '@/lib/template-engine'
import { SOLO_EXECUTION_PROTOCOL, TEAM_EXECUTION_PROTOCOL, BASE_EXECUTION_RULES } from '@/lib/decompose-prompt'

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

// POST /api/templates/[id]/run — 从模版创建任务并激活
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params

    // 1. 加载模版（含发布者信息，用于 pre_check 分配）
    const template = await prisma.taskTemplate.findUnique({
      where: { id },
      include: {
        workspace: { select: { name: true } },
        creator: {
          select: {
            id: true, name: true, nickname: true,
            agent: { select: { id: true, name: true, isMainAgent: true, parentAgentId: true, status: true } }
          }
        },
      },
    })
    if (!template) {
      return NextResponse.json({ error: '模版不存在' }, { status: 404 })
    }
    if (!template.isEnabled) {
      return NextResponse.json({ error: '该模版已归档' }, { status: 400 })
    }

    // P2 防护：课程不能通过 run 执行，应通过 /api/academy/enroll 报名
    if (template.courseType) {
      return NextResponse.json({
        error: '这是一门课程，请通过 POST /api/academy/enroll 报名，而不是 run',
        hint: `POST /api/academy/enroll  body: { "templateId": "${id}" }`,
      }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const {
      variables: userVariables = {},
      overrides = {},
      parties: partiesInput = [],  // 多方参与配置
    } = body

    // 解析参与方列表，类型定义
    interface Party {
      role: string       // "party-a" | "party-b" | "party-c" ...
      label: string      // 显示名称，如"甲方"
      bindType: 'self' | 'simulate' | 'invite' | 'agent'
      orgName?: string   // simulate/invite 时的组织名
      materials?: string[]  // 背景资料 URL 列表
      agentId?: string   // bindType=agent 时指定的 agentId
      userId?: string    // 运行时填充（agentId → userId）
    }
    const parties: Party[] = Array.isArray(partiesInput) ? partiesInput : []

    // 解析各方显示名（用于模版变量替换 {{party-a}} 等）
    const partyNameMap: Record<string, string> = {}
    for (const p of parties) {
      // self: 优先 orgName → runner 姓名 → label → role
      // 其他: 优先 orgName → label → role
      partyNameMap[p.role] = p.orgName ||
        (p.bindType === 'self' ? (auth.user.name || auth.user.nickname || '') : '') ||
        p.label || p.role
    }

    // 预查 bindType=agent 的参与方：agentId → userId
    for (const p of parties) {
      if (p.bindType === 'agent' && p.agentId) {
        const agentRecord = await prisma.agent.findUnique({
          where: { id: p.agentId },
          select: { userId: true }
        })
        p.userId = agentRecord?.userId ?? undefined
      }
    }

    // resolvePartyAssignee: 根据 partyRole 找到步骤应分配给谁
    // 返回 { assigneeId, isPendingInvite, simulateAs? }
    function resolvePartyAssignee(partyRole: string | undefined | null): {
      assigneeId: string | null
      isPendingInvite: boolean
      simulateAs: string | null
      simulateMaterials: string[]
    } {
      if (!partyRole) {  // 任意 partyRole 均支持（不限 party- 前缀）
        return { assigneeId: null, isPendingInvite: false, simulateAs: null, simulateMaterials: [] }
      }
      const party = parties.find(p => p.role === partyRole)
      if (!party) {
        return { assigneeId: null, isPendingInvite: false, simulateAs: null, simulateMaterials: [] }
      }
      switch (party.bindType) {
        case 'self':
          return { assigneeId: auth!.userId, isPendingInvite: false, simulateAs: null, simulateMaterials: [] }
        case 'agent':
          return { assigneeId: party.userId || null, isPendingInvite: false, simulateAs: null, simulateMaterials: [] }
        case 'simulate':
          // 主 Agent 执行，但注入角色扮演指令
          return {
            assigneeId: auth!.userId,
            isPendingInvite: false,
            simulateAs: party.orgName || party.label || partyRole,
            simulateMaterials: party.materials || [],
          }
        case 'invite':
          return { assigneeId: null, isPendingInvite: true, simulateAs: null, simulateMaterials: [] }
        default:
          return { assigneeId: null, isPendingInvite: false, simulateAs: null, simulateMaterials: [] }
      }
    }

    // 2. 解析模版定义
    let variableDefs: VariableDefinition[] = []
    let stepsTemplate: StepTemplate[] = []
    try {
      variableDefs = JSON.parse(template.variables)
    } catch (e) {
      console.warn('[Templates/Run] variables parse failed:', (template.variables || '').substring(0, 200), e)
      variableDefs = []
    }
    try {
      stepsTemplate = JSON.parse(template.stepsTemplate)
    } catch (e) {
      console.error('[Templates/Run] stepsTemplate parse failed:', (template.stepsTemplate || '').substring(0, 200), e)
      return NextResponse.json({ error: '步骤模板格式错误' }, { status: 500 })
    }
    if (!Array.isArray(stepsTemplate) || stepsTemplate.length === 0) {
      return NextResponse.json({ error: '模版步骤为空' }, { status: 500 })
    }

    // 3. 校验并合并变量
    const builtins = getBuiltinVariables(auth.user.name || undefined, template.workspace?.name)
    const { valid, errors, resolved } = validateVariables(variableDefs, userVariables)
    if (!valid) {
      return NextResponse.json({ error: '变量校验失败', details: errors }, { status: 400 })
    }
    // 合并：用户变量 > 默认值 > 内置变量 > party 显示名（{{party-a}} 等）
    const allVariables = { ...builtins, ...resolved, ...partyNameMap }

    // 4. V1.1: 实例化步骤（executionProtocol + promptTemplate → step.description）
    // 若模版未设置自定义协议，按 defaultMode 选用全局硬指令（Solo/Team）
    const effectiveProtocol = template.executionProtocol ||
      (template.defaultMode === 'team' ? TEAM_EXECUTION_PROTOCOL : SOLO_EXECUTION_PROTOCOL)
    const steps = instantiateSteps(stepsTemplate, allVariables, effectiveProtocol)

    // P2-2: 模版级 approvalMode 覆盖步骤的 requiresApproval
    // approvalMode: "auto" → 所有步骤自动通过（无需人工审核）
    if (template.approvalMode === 'auto') {
      for (const s of steps) {
        s.requiresApproval = false
      }
    }

    // 4.4 parties 分配：partyRole（新字段）优先级最高，在 assigneeHint 之前处理
    // partyRole = "party-a" | "party-b" 等，来自模版步骤 JSON 的 partyRole 字段
    interface PartyResolution {
      assigneeId: string | null
      isPendingInvite: boolean
      simulateAs: string | null
      simulateMaterials: string[]
    }
    const partyResolutions: PartyResolution[] = []

    for (let i = 0; i < steps.length; i++) {
      const partyRole = (stepsTemplate[i] as any)?.partyRole as string | undefined
      const res = resolvePartyAssignee(partyRole)
      partyResolutions.push(res)

      if (partyRole) {  // 任意 partyRole 字符串均生效（不限 party- 前缀，支持 trainee/examiner 等语义名）
        // partyRole 有效：覆盖 assigneeId（后续 4.5/4.6/4.7 跳过此步骤）
        if (!res.isPendingInvite) {
          steps[i].assigneeId = res.assigneeId
          steps[i].unassigned = !res.assigneeId
          steps[i].unassignedReason = !res.assigneeId ? `party ${partyRole} 未绑定有效用户` : null
        } else {
          // pending_invite: assigneeId 保持 null，等真人加入后绑定
          steps[i].assigneeId = null
          steps[i].unassigned = true
          steps[i].unassignedReason = `等待 ${partyRole} 接受邀请后激活`
        }
      }
    }

    // 4.5 F-001: assigneeHint 变量替换 → 匹配工作区成员 → 设置 assigneeId
    // App Store 原则：模板公共，任务私有。任务建在使用者自己的工作区，成员从使用者工作区匹配
    // 例: assigneeHint: "{{agentName}}" → 变量替换 "八爪" → 匹配到八爪的 userId
    const runnerWorkspaceMembership = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId, role: 'owner' },
      select: { workspaceId: true }
    })
    const runnerWorkspaceId = runnerWorkspaceMembership?.workspaceId ?? template.workspaceId
    console.log(`[Templates/Run] 任务将建在使用者工作区: ${runnerWorkspaceId}${runnerWorkspaceId === template.workspaceId ? ' (与模版同一工作区)' : ' (不同于模版工作区)'}`)

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: runnerWorkspaceId },
      include: { user: { select: { id: true, name: true, nickname: true, agent: { select: { name: true } } } } },
    })
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].assigneeId) continue // 已有 assigneeId，跳过
      const partyRole4_5 = (stepsTemplate[i] as any)?.partyRole as string | undefined
      if (partyRole4_5) continue // 已由 partyRole 处理，跳过
      const hint = stepsTemplate[i]?.assigneeHint
      if (!hint) continue
      const resolvedHint = resolveVariables(hint, allVariables).trim()
      if (!resolvedHint || resolvedHint.startsWith('{{')) continue // 未解析的变量，跳过

      // B5-fix: 按 assigneeRole 区分匹配策略
      const role = stepsTemplate[i]?.assigneeRole
      const matched = members.find(m => {
        const agentName = (m.user.agent as any)?.name
        const userName = m.user.name
        const userNick = m.user.nickname

        if (role === 'human') {
          // 人类步骤：只匹配用户名/昵称，不查 Agent 名（避免 Lobster→Aurora 串台）
          if (userName === resolvedHint || userNick === resolvedHint) return true
          if (userName && (userName.includes(resolvedHint) || resolvedHint.includes(userName))) return true
          if (userNick && (userNick.includes(resolvedHint) || resolvedHint.includes(userNick))) return true
          return false
        }

        if (role === 'agent') {
          // Agent 步骤：只匹配 Agent 名
          if (agentName && agentName === resolvedHint) return true
          if (agentName && (agentName.includes(resolvedHint) || resolvedHint.includes(agentName))) return true
          return false
        }

        // auto / 未指定：全量匹配（Agent名 > 人名/昵称）
        if (agentName && agentName === resolvedHint) return true
        if (userName === resolvedHint || userNick === resolvedHint) return true
        if (agentName && (agentName.includes(resolvedHint) || resolvedHint.includes(agentName))) return true
        if (userName && (userName.includes(resolvedHint) || resolvedHint.includes(userName))) return true
        return false
      })
      if (matched) {
        steps[i].assigneeId = matched.user.id
        steps[i].unassigned = false
        steps[i].unassignedReason = null
      } else {
        steps[i].unassigned = true
        steps[i].unassignedReason = `模板指定「${resolvedHint}」但未匹配到成员`
      }
    }

    // 4.5b: sub-agent 轮询分配
    // 步骤模板标 assigneeRole: "sub-agent" → 不写死名字，服务端按轮询分配给使用者的子 Agent
    // 没有子 Agent → 降级给主 Agent；没有主 Agent → 保持 unassigned（4.7 fallback 处理）
    const runnerMainAgent = await prisma.agent.findUnique({
      where: { userId: auth.userId },
      select: { id: true, name: true }
    })
    const runnerSubAgents = runnerMainAgent
      ? await prisma.agent.findMany({
          where: { parentAgentId: runnerMainAgent.id },
          select: { id: true, name: true, userId: true },
          orderBy: { createdAt: 'asc' },
        })
      : []

    if (runnerSubAgents.length > 0) {
      console.log(`[Templates/Run] 子 Agent 列表(轮询): ${runnerSubAgents.map(a => a.name).join(', ')}`)
    }

    let subAgentRRIndex = 0
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].assigneeId) continue
      const partyRole4_5b = (stepsTemplate[i] as any)?.partyRole as string | undefined
      if (partyRole4_5b) continue
      if (stepsTemplate[i]?.assigneeRole !== 'sub-agent') continue

      if (runnerSubAgents.length > 0) {
        const picked = runnerSubAgents[subAgentRRIndex % runnerSubAgents.length]
        steps[i].assigneeId = picked.userId
        steps[i].unassigned = false
        steps[i].unassignedReason = null
        console.log(`[Templates/Run] sub-agent 轮询: 步骤「${steps[i].title}」→ ${picked.name}`)
        subAgentRRIndex++
      } else if (runnerMainAgent) {
        // 没有子 Agent → 降级主 Agent
        steps[i].assigneeId = auth.userId
        steps[i].unassigned = false
        steps[i].unassignedReason = null
        console.log(`[Templates/Run] sub-agent 无子Agent，降级主Agent: 步骤「${steps[i].title}」`)
      }
      // 完全没 Agent → 保持 unassigned，4.7 fallback 再处理
    }

    // 4.6 P0-2 fix: 标题变量推导 assignee（跳过已被 partyRole 处理的步骤）
    // 当 assigneeHint 为空时，从步骤标题中的 {{variable}} 推导 assignee
    // 例: title "{{brideSide}} 提出期望" → brideSide="Aurora" → 匹配 Aurora 的 userId
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].assigneeId) continue // 已分配，跳过
      const partyRole4_6 = (stepsTemplate[i] as any)?.partyRole as string | undefined
      if (partyRole4_6) continue // 已由 partyRole 处理，跳过
      const titleTemplate = stepsTemplate[i]?.title || ''
      // 提取标题中第一个 {{variable}}
      const varMatch = titleTemplate.match(/\{\{([\w-]+)\}\}/)
      if (!varMatch) continue
      const varName = varMatch[1]
      const varValue = allVariables[varName]
      if (!varValue || typeof varValue !== 'string') continue
      const inferredHint = varValue.trim()
      if (!inferredHint) continue

      const role = stepsTemplate[i]?.assigneeRole
      const matched = members.find(m => {
        const agentName = (m.user.agent as any)?.name
        const userName = m.user.name
        const userNick = m.user.nickname
        if (role === 'human') {
          if (userName === inferredHint || userNick === inferredHint) return true
          if (userName && (userName.includes(inferredHint) || inferredHint.includes(userName))) return true
          if (userNick && (userNick.includes(inferredHint) || inferredHint.includes(userNick))) return true
          return false
        }
        if (role === 'agent') {
          if (agentName && agentName === inferredHint) return true
          if (agentName && (agentName.includes(inferredHint) || inferredHint.includes(agentName))) return true
          return false
        }
        if (agentName && agentName === inferredHint) return true
        if (userName === inferredHint || userNick === inferredHint) return true
        if (agentName && (agentName.includes(inferredHint) || inferredHint.includes(agentName))) return true
        if (userName && (userName.includes(inferredHint) || inferredHint.includes(userName))) return true
        return false
      })
      if (matched) {
        steps[i].assigneeId = matched.user.id
        steps[i].unassigned = false
        steps[i].unassignedReason = null
        console.log(`[Templates/Run] P0-2: title var {{${varName}}}="${inferredHint}" → matched ${matched.user.name}`)
      }
    }

    // 4.7 Fallback: 未分配的步骤自动分配给创建者（partyRole 步骤跳过，由 parties 系统管理）
    // 解决 P0: assigneeHint 为空或匹配失败时 assigneeId=null → Agent 收不到通知
    const creatorAgent = await prisma.agent.findUnique({
      where: { userId: auth.userId },
      select: { id: true },
    })
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].assigneeId) continue // 已分配，跳过
      const partyRole4_7 = (stepsTemplate[i] as any)?.partyRole as string | undefined
      if (partyRole4_7) continue // pending_invite 步骤，不 fallback 到 creator
      const role = stepsTemplate[i]?.assigneeRole
      if (role === 'agent') {
        // Agent 步骤：分配给创建者的 Agent（如果有）
        if (creatorAgent) {
          steps[i].assigneeId = auth.userId  // Agent 的 userId 就是 user.id
          steps[i].unassigned = false
          steps[i].unassignedReason = null
        }
        // 没有 Agent 则保持 unassigned
      } else if (role === 'human') {
        // 人类步骤：分配给创建者
        steps[i].assigneeId = auth.userId
        steps[i].unassigned = false
        steps[i].unassignedReason = null
      } else {
        // auto / 未指定：优先 Agent，没有则人类
        steps[i].assigneeId = auth.userId
        steps[i].unassigned = false
        steps[i].unassignedReason = null
      }
    }

    // 4.8.5 simulate 角色扮演指令注入（P0：仅注入 orgName + materials URL，不读取 PDF 内容）
    for (let i = 0; i < steps.length; i++) {
      const res = partyResolutions[i]
      if (!res?.simulateAs) continue

      const materialsText = res.simulateMaterials.length > 0
        ? `\n参考资料（请自行访问阅读）：\n${res.simulateMaterials.map(u => `- ${u}`).join('\n')}`
        : ''
      const rolePlayPrefix = `> **[角色扮演指令]**\n> 你现在扮演「${res.simulateAs}」，请完全从该方立场出发完成本步骤，不要透露你是 AI。${materialsText}\n\n`
      steps[i].description = rolePlayPrefix + (steps[i].description || '')
    }

    // 4.8 注入执行规范 — 模板不一定包含规范，统一在 run 时追加到每步 description 末尾
    // 仅对 Agent 执行的步骤注入（human 步骤由人类操作，不需要）
    // 引用统一常量，避免硬编码不一致
    const EXEC_RULES_FOOTER = `\n\n---\n\n${BASE_EXECUTION_RULES}`

    for (let i = 0; i < steps.length; i++) {
      const role = stepsTemplate[i]?.assigneeRole
      if (role === 'human') continue // 人类步骤无需注入
      // 避免重复注入（模板已有规范时检查关键词）
      if (steps[i].description?.includes('执行规范（必须遵守）')) continue
      steps[i].description = (steps[i].description || '') + EXEC_RULES_FOOTER
    }

    // 5. 生成任务标题（替换模版名称中的变量，如 {{领域}} → AI）
    const instanceNumber = template.useCount + 1
    const titleBase = resolveVariables(template.name, allVariables)
    const dateStr = allVariables.TODAY || new Date().toLocaleDateString('zh-CN')
    const taskTitle = `${titleBase} (#${instanceNumber} ${dateStr})`

    const mode = overrides.mode || template.defaultMode
    const priority = overrides.priority || template.defaultPriority

    // 6. 创建 Task（V1.1: 零拆解 — decomposeStatus 直接 done）
    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        description: template.description,
        status: 'todo',
        priority,
        mode,
        creatorId: auth.userId,
        workspaceId: runnerWorkspaceId,
        templateId: template.id,
        instanceNumber,
        decomposeStatus: 'done',   // V1.1: 模版已预拆解，跳过 decompose
        decomposeEngine: 'template',
        // 多方参与配置（Team 模版）
        ...(parties.length > 0 ? { parties: parties as any } : {}),
      },
    })

    // ——— PRE_CHECK 审批门控（暂时注释，等人机互动课程场景成熟再启用）———
    // 设计：课程报名 → 发布者 Agent 做 pre_check 确认执行计划；普通模版 → 创建者 Agent 确认
    // 启用条件：requiresApprovalGate=true 时插入 pre_check 步骤，task.isApproved=false
    // 审批通过后 → isApproved=true → 任务对所有参与方可见
    // 代码备份见 git history（2026-03-22 之前版本）
    // ——————————————————————————————————————————————————

    // 7. 创建 TaskSteps（V1.1: 含 humanInput + unassigned 字段）
    const createdSteps: any[] = []
    let unassignedCount = 0
    let pendingInviteCount = 0
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const partyRes = partyResolutions[i]
      const isPendingInvite = partyRes?.isPendingInvite ?? false

      const stepPartyRole = (stepsTemplate[i] as any)?.partyRole as string | undefined
      const step = await prisma.taskStep.create({
        data: {
          title: s.title,
          description: s.description,
          order: s.order,
          stepType: s.stepType,
          assigneeId: s.assigneeId,
          requiresApproval: s.requiresApproval,
          parallelGroup: s.parallelGroup,
          inputs: s.inputs,
          outputs: s.outputs,
          skills: s.skills,
          taskId: task.id,
          // pending_invite: 等真人加入后激活；否则正常 pending
          status: isPendingInvite ? 'pending_invite' : 'pending',
          agentStatus: null,  // 初始 null，由 activateAndNotifySteps 激活后设为 'pending'
          // V1.1
          needsHumanInput: s.needsHumanInput,
          humanInputPrompt: s.humanInputPrompt,
          humanInputStatus: s.humanInputStatus,
          unassigned: s.unassigned,
          unassignedReason: s.unassignedReason,
          // Team 多方：保存 partyRole 供邀请方加入后自动绑定
          ...(stepPartyRole ? { partyRole: stepPartyRole } : {}),
        },
      })
      if (isPendingInvite) pendingInviteCount++
      else if (s.unassigned) unassignedCount++

      // 创建 StepAssignee 记录
      // P0-1 fix: 用模板的 assigneeRole 决定 assigneeType，不再纯靠 auto-detect
      if (s.assigneeId) {
        const role = stepsTemplate[i]?.assigneeRole
        let assigneeType: 'agent' | 'human'
        if (role === 'human') {
          assigneeType = 'human'
        } else if (role === 'agent') {
          assigneeType = 'agent'
        } else {
          // auto / 未指定：auto-detect
          const assigneeAgent = await prisma.agent.findUnique({
            where: { userId: s.assigneeId },
            select: { id: true },
          })
          assigneeType = assigneeAgent ? 'agent' : 'human'
        }
        await prisma.stepAssignee.create({
          data: {
            stepId: step.id,
            userId: s.assigneeId,
            isPrimary: true,
            assigneeType,
          },
        }).catch(() => {})
      }

      createdSteps.push(step)
    }

    // 8. V1.1: 激活可执行的步骤（带 fromTemplate 标记，Agent 直接执行不拆解）
    // pending_invite 步骤排除在外，等真人加入后再激活
    const activatableCreatedSteps = createdSteps.filter(s => s.status !== 'pending_invite')
    if (activatableCreatedSteps.length > 0) {
      const startable = getStartableSteps(activatableCreatedSteps)
      await activateAndNotifySteps(task.id, startable, { fromTemplate: true, templateName: template.name })
    }

    // 9. 更新模版统计
    await prisma.taskTemplate.update({
      where: { id },
      data: {
        useCount: instanceNumber,
        lastUsedAt: new Date(),
      },
    })

    // 10. 通知创建者
    sendToUser(auth.userId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title,
    })
    await createNotification({
      userId: auth.userId,
      type: 'task_assigned',
      title: '📋 模版任务已创建',
      content: `从模版「${template.name}」创建任务，共 ${createdSteps.length} 个步骤`,
      taskId: task.id,
    })

    // 10.1 通知所有步骤 assignee（含非 startable 的后续步骤）
    // 解决：人类步骤在前时，后续 Agent 完全不知道有新任务
    const allAssigneeIds = new Set<string>()
    for (const s of steps) {
      if (s.assigneeId && s.assigneeId !== auth.userId) {
        allAssigneeIds.add(s.assigneeId)
      }
    }
    for (const uid of allAssigneeIds) {
      sendToUser(uid, {
        type: 'task:created',
        taskId: task.id,
        title: task.title,
        fromTemplate: true,
        templateName: template.name,
      })
    }

    console.log(`[Templates/Run] ✅ "${template.name}" → Task ${task.id} (${createdSteps.length} steps)`)

    return NextResponse.json({
      taskId: task.id,
      title: task.title,
      stepsCreated: createdSteps.length,
      unassignedCount,
      pendingInviteCount,
      message: pendingInviteCount > 0
        ? `从模版创建成功，${pendingInviteCount} 个步骤等待邀请方加入后激活`
        : unassignedCount > 0
          ? `从模版创建成功，有 ${unassignedCount} 个步骤待分配`
          : `从模版创建成功，已通知 Agent`,
    })
  } catch (error) {
    console.error('[Templates/Run] 失败:', error)
    return NextResponse.json({ error: '执行模版失败' }, { status: 500 })
  }
}
