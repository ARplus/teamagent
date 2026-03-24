import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, sendToUsers } from '@/lib/events'
import { processWorkflowAfterSubmit } from '@/lib/workflow-engine'
import { getStartableSteps, activateAndNotifySteps, checkAndCompleteParentStep } from '@/lib/step-scheduling'
import { generateSummary } from '@/lib/ai-summary'
import { createNotification, notificationTemplates } from '@/lib/notifications'
import { extractIdempotencyKey, checkIdempotency, saveIdempotency } from '@/lib/idempotency'
import { SOLO_EXECUTION_PROTOCOL } from '@/lib/decompose-prompt'

// 统一认证：支持 Token 或 Session
async function authenticate(req: NextRequest) {
  // 先尝试 API Token
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }

  // 尝试 Session（人类用户浏览器访问）
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

/**
 * POST /api/steps/[id]/submit
 *
 * Agent 提交步骤结果，等待人类审核
 *
 * Body:
 * {
 *   result: string,          // 结果描述；decompose 步骤时为 JSON 步骤列表
 *   summary?: string,
 *   attachments?: [{ name: string, url: string, type?: string }]
 * }
 *
 * decompose 步骤格式（result 字段）：
 * [
 *   {
 *     title: string,
 *     description?: string,
 *     assignee?: string,          // Agent 名字（可选）
 *     requiresApproval?: boolean, // 默认 true
 *     parallelGroup?: string,     // 相同字符串 = 并行执行
 *     inputs?: string[],
 *     outputs?: string[],
 *     skills?: string[],
 *     stepType?: 'task' | 'meeting',
 *     agenda?: string,
 *     participants?: string[]
 *   }
 * ]
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const { result, summary, attachments } = body
    // 兼容两种写法：waitingForHuman: true 或 status: "waiting_human"
    const waitingForHuman = body.waitingForHuman === true || body.status === 'waiting_human'
    // 影子军团：Watch 可在 body 中传 onBehalfOf，声明代哪个子 Agent 提交
    const onBehalfOf: string | undefined = body.onBehalfOf || undefined
    // 军费统计：Watch 上报的精细指标（优先使用真实 token，兼容旧版字符估算）
    const metrics: { durationMs?: number; promptChars?: number; resultChars?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number; model?: string; assigneeName?: string } | undefined = body.metrics || undefined

    // A2A: 幂等键检查 — 防止重复提交
    const idempotencyKey = extractIdempotencyKey(req, body)
    if (idempotencyKey) {
      const cached = await checkIdempotency(idempotencyKey)
      if (cached.hit) {
        return NextResponse.json(cached.cachedBody, { status: cached.cachedStatus })
      }
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true, title: true, creatorId: true, workspaceId: true,
            mode: true,
            steps: { select: { id: true, order: true } }
          }
        }
      }
    })

    if (!step) return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    // B08: 权限检查 — assigneeId 或 StepAssignee 表中有记录 或 任务创建者
    const stepAssigneeRecord = await prisma.stepAssignee.findUnique({
      where: { stepId_userId: { stepId: id, userId: auth.userId } }
    }).catch(() => null)
    const isTaskCreator = step.task.creatorId === auth.userId

    // 影子军团：主 Agent 可代子 Agent 提交
    let isParentAgentSubmitting = false
    if (step.assigneeId && step.assigneeId !== auth.userId && !stepAssigneeRecord && !isTaskCreator) {
      const submittingAgent = await prisma.agent.findUnique({
        where: { userId: auth.userId },
        select: { id: true, parentAgentId: true }
      }).catch(() => null)
      if (submittingAgent && !submittingAgent.parentAgentId) {
        const assigneeAgent = await prisma.agent.findUnique({
          where: { userId: step.assigneeId },
          select: { parentAgentId: true }
        }).catch(() => null)
        isParentAgentSubmitting = assigneeAgent?.parentAgentId === submittingAgent.id
      }
    }

    if (step.assigneeId !== auth.userId && !stepAssigneeRecord && !isTaskCreator && !isParentAgentSubmitting) {
      return NextResponse.json({ error: '你不是此步骤的负责人' }, { status: 403 })
    }

    // 影子军团：计算实际提交者 ID（显示在提交历史中的人）
    // 优先级：body.onBehalfOf > 自动检测(isParentAgentSubmitting → step.assigneeId) > auth.userId
    const effectiveSubmitterId = onBehalfOf || (isParentAgentSubmitting && step.assigneeId ? step.assigneeId : auth.userId)
    // 允许 pending / in_progress / waiting_human 状态提交（人类步骤用 waiting_human）
    if (step.status !== 'in_progress' && step.status !== 'pending' && step.status !== 'waiting_human') {
      return NextResponse.json({ error: '步骤不在可提交状态' }, { status: 400 })
    }

    // Team 任务：拦截 Watch fallback 自动提交（OpenClaw 不在线时生成的占位文本）
    // 重置回 pending，等 OpenClaw 在线后 Watch 重连补发再执行
    const isTeamTask = (step.task as any).mode === 'team'
    const FALLBACK_PATTERN = /^步骤 ".+?" 已由 Agent 完成。\s*执行时间:/
    if (isTeamTask && result && FALLBACK_PATTERN.test(result.trim())) {
      await prisma.taskStep.update({
        where: { id },
        data: { status: 'pending', agentStatus: 'pending' }
      })
      return NextResponse.json({ error: 'Team任务步骤须通过主会话执行，请确保 OpenClaw 在线后重试' }, { status: 400 })
    }

    // B-000: 串行顺序强制 — 前序步骤未完成时不能提交
    const allSteps = await prisma.taskStep.findMany({
      where: { taskId: step.taskId },
      select: { id: true, order: true, status: true, parallelGroup: true, requiresApproval: true },
      orderBy: { order: 'asc' },
    })
    const myGroup = (step as any).parallelGroup as string | null
    const blockers = allSteps.filter(s => {
      if (s.order >= step.order) return false
      // waiting_approval + requiresApproval=true：必须等人类审批通过，不能跳过
      if (s.status === 'waiting_approval' && s.requiresApproval) return true
      if (['done', 'skipped', 'waiting_approval', 'waiting_human'].includes(s.status)) return false
      if (myGroup && s.parallelGroup === myGroup) return false
      return true
    })
    if (blockers.length > 0) {
      const names = blockers.map(b => `步骤${b.order}`).join('、')
      return NextResponse.json({ error: `前序步骤未完成（${names}），请按顺序执行` }, { status: 409 })
    }

    const now = new Date()

    // ================================================================
    // 🔀 decompose 步骤：展开为子步骤
    // ================================================================
    if (step.stepType === 'decompose') {
      let parsedSteps: any[]
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result)
        // 尝试解析：可能是纯 JSON 数组，也可能包在对象里
        const parsed = JSON.parse(raw)
        parsedSteps = Array.isArray(parsed) ? parsed : (parsed.steps ?? [])
        if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
          return NextResponse.json({ error: 'decompose result 需要是非空 JSON 步骤数组' }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: 'result 不是合法 JSON，无法展开步骤' }, { status: 400 })
      }

      // 获取工作区成员（用于 assignee 名字 → userId 匹配）
      const workspaceMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: step.task.workspaceId },
        include: {
          user: {
            select: {
              id: true, name: true, nickname: true,
              agent: { select: { name: true, capabilities: true } }
            }
          }
        }
      })

      function findUserByAgentName(agentName: string): string | null {
        if (!agentName) return null
        const m = workspaceMembers.find(m =>
          (m.user.agent as any)?.name === agentName ||
          (m.user.agent as any)?.name?.includes(agentName) ||
          agentName.includes((m.user.agent as any)?.name || '') ||
          m.user.name === agentName || m.user.nickname === agentName
        )
        return m?.user.id ?? null
      }

      // 当前最大 order（decompose 步骤之后插入）
      const maxOrder = Math.max(...step.task.steps.map(s => s.order), 0)
      let orderOffset = maxOrder

      const createdSteps = []
      const involvedUserIds = new Set<string>()

      for (const s of parsedSteps) {
        orderOffset++
        const isHumanStep = s.assigneeType === 'human'
        // 人类步骤找不到时 fallback 到任务创建者
        let assigneeId = s.assignee ? findUserByAgentName(s.assignee) : null
        if (isHumanStep && !assigneeId && step.task.creatorId) {
          assigneeId = step.task.creatorId
        }
        if (assigneeId) involvedUserIds.add(assigneeId)

        // 注入全局硬指令到每个 Agent 步骤的 description
        const isHumanAssigned = s.assigneeType === 'human'
        let finalDesc = s.description || null
        if (!isHumanAssigned) {
          finalDesc = finalDesc
            ? `${SOLO_EXECUTION_PROTOCOL}\n\n---\n\n## 本步骤任务\n\n${finalDesc}`
            : SOLO_EXECUTION_PROTOCOL
        }

        const created = await prisma.taskStep.create({
          data: {
            title: s.title,
            description: finalDesc,
            order: orderOffset,
            taskId: step.task.id,
            stepType: s.stepType || 'task',
            assigneeId,
            assigneeNames: s.assignee ? JSON.stringify([s.assignee]) : null,
            requiresApproval: s.requiresApproval !== false, // 默认 true
            parallelGroup: s.parallelGroup || null,
            inputs: s.inputs?.length ? JSON.stringify(s.inputs) : null,
            outputs: s.outputs?.length ? JSON.stringify(s.outputs) : null,
            skills: s.skills?.length ? JSON.stringify(s.skills) : null,
            agenda: s.agenda || null,
            participants: s.participants?.length ? JSON.stringify(s.participants) : null,
            status: 'pending',
            agentStatus: assigneeId ? 'pending' : null,
          }
        })

        // human 步骤：创建 StepAssignee 记录，让 activateAndNotifySteps 能识别 allHuman=true
        if (isHumanStep && assigneeId) {
          await prisma.stepAssignee.create({
            data: { stepId: created.id, userId: assigneeId, assigneeType: 'human', status: 'pending' }
          })
        }

        createdSteps.push(created)
      }

      // 将 decompose 步骤标为 done（自动完成，不需要审批）
      await prisma.taskStep.update({
        where: { id },
        data: {
          status: 'done',
          agentStatus: 'done',
          result: `已拆解为 ${createdSteps.length} 个步骤`,
          completedAt: now,
          approvedAt: now,
          agentDurationMs: step.startedAt ? now.getTime() - new Date(step.startedAt).getTime() : null
        }
      })

      // 更新 Agent 状态
      const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } })
      if (agent) await prisma.agent.update({ where: { userId: auth.userId }, data: { status: 'online' } })

      // 通知所有被分配的 Agent（第一个 pending 步骤可以开始了）
      if (involvedUserIds.size > 0) {
        const userIds = Array.from(involvedUserIds)
        sendToUsers(userIds, { type: 'task:created', taskId: step.task.id, title: step.task.title })

        // 通知可以立刻开始的步骤 + 触发 Agent 自动执行
        const startableSteps = getStartableSteps(createdSteps)
        await activateAndNotifySteps(step.task.id, startableSteps as any[])
      }

      // 通知任务创建者
      if (step.task.creatorId) {
        sendToUser(step.task.creatorId, {
          type: 'task:parsed',
          taskId: step.task.id,
          stepCount: createdSteps.length,
          engine: 'agent'
        })
      }

      console.log(`[Decompose] 任务 ${step.task.id} 已拆解为 ${createdSteps.length} 步，通知 ${involvedUserIds.size} 个 Agent`)

      const decomposeResponse = {
        message: `✅ 任务已拆解为 ${createdSteps.length} 个步骤，已通知相关 Agent`,
        steps: createdSteps,
        involvedAgents: involvedUserIds.size
      }
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 'POST', `/api/steps/${id}/submit`, 200, decomposeResponse)
      }
      return NextResponse.json(decomposeResponse)
    }

    // ================================================================
    // 📋 pre_check 步骤：解析补充子步骤并追加（Solo 专属）
    // ================================================================
    if (step.stepType === 'pre_check') {
      // 尝试从 result 中解析 extraSteps（可选，Agent 可以不提供）
      let extraSteps: any[] = []
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result || '')
        // 支持 JSON 内嵌在 Markdown 代码块中
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
          if (Array.isArray(parsed.extraSteps) && parsed.extraSteps.length > 0) {
            extraSteps = parsed.extraSteps
          }
        }
      } catch { /* extraSteps 是可选的，解析失败不影响流程 */ }

      if (extraSteps.length > 0) {
        // 追加子步骤到任务末尾
        const workspaceMembers = await prisma.workspaceMember.findMany({
          where: { workspaceId: step.task.workspaceId },
          include: {
            user: {
              select: { id: true, name: true, nickname: true, agent: { select: { name: true } } }
            }
          }
        })
        function findMemberId(hint: string): string | null {
          const m = workspaceMembers.find(m =>
            (m.user.agent as any)?.name === hint ||
            m.user.name === hint || m.user.nickname === hint
          )
          return m?.user.id ?? null
        }

        const currentMaxOrder = Math.max(...step.task.steps.map(s => s.order), 1)
        let orderOffset = currentMaxOrder

        for (const s of extraSteps) {
          orderOffset++
          const isHumanStep = s.assigneeType === 'human'
          // fallback: 没指定 assignee 时，agent步骤给任务创建者，防止孤儿步骤卡住工作流
          const assigneeId = s.assignee ? findMemberId(s.assignee) : (isHumanStep ? step.task.creatorId : step.task.creatorId)
          await prisma.taskStep.create({
            data: {
              title: s.title,
              description: s.description || null,
              order: orderOffset,
              taskId: step.task.id,
              stepType: s.stepType || 'task',
              assigneeId,
              requiresApproval: s.requiresApproval !== false,
              status: 'pending',
              agentStatus: assigneeId && !isHumanStep ? 'pending' : null,
            }
          })
          if (assigneeId && isHumanStep) {
            await prisma.stepAssignee.create({
              data: { stepId: (await prisma.taskStep.findFirst({ where: { taskId: step.task.id, order: orderOffset }, select: { id: true } }))!.id, userId: assigneeId, assigneeType: 'human' }
            }).catch(() => {})
          }
        }
        console.log(`[PreCheck] 追加 ${extraSteps.length} 个补充子步骤到任务 ${step.task.id}`)
      }

      // pre_check 继续走普通提交流程（requiresApproval=true → waiting_approval，等学员确认）
      console.log(`[PreCheck] 发布者 Agent 提交执行计划，等待学员确认${extraSteps.length > 0 ? `（含 ${extraSteps.length} 个补充步骤）` : ''}`)
    }

    // ================================================================
    // 📋 普通步骤提交（原有逻辑）
    // ================================================================
    const agentDurationMs = step.startedAt ? now.getTime() - new Date(step.startedAt).getTime() : null

    // P1-C4: summary 不再阻塞提交 — 先提交，后台异步生成
    let finalSummary = summary || null

    const resultText = result || '任务已完成，等待审核'

    // B08: 更新该用户的 StepAssignee 状态（影子军团：更新子 Agent 的记录，不是 Lobster 的）
    if (isParentAgentSubmitting && effectiveSubmitterId !== auth.userId) {
      // 代提交：找子 Agent 的 StepAssignee 记录并更新
      const subAssigneeRecord = await prisma.stepAssignee.findUnique({
        where: { stepId_userId: { stepId: id, userId: effectiveSubmitterId } }
      }).catch(() => null)
      if (subAssigneeRecord) {
        await prisma.stepAssignee.update({
          where: { id: subAssigneeRecord.id },
          data: { status: 'submitted', submittedAt: now, result: resultText }
        })
      }
    } else if (stepAssigneeRecord) {
      await prisma.stepAssignee.update({
        where: { id: stepAssigneeRecord.id },
        data: { status: 'submitted', submittedAt: now, result: resultText }
      })
    }

    // B08: 检查多人完成模式
    const allAssignees = await prisma.stepAssignee.findMany({ where: { stepId: id } })
    const isMultiAssignee = allAssignees.length > 1
    let isStepComplete = true // 默认单人模式直接完成

    if (isMultiAssignee) {
      if (step.completionMode === 'all') {
        // 显式要求全员完成时才等所有人
        const allSubmitted = allAssignees.every(a =>
          a.status === 'submitted' || a.userId === auth.userId
        )
        isStepComplete = allSubmitted
      } else {
        // 默认 "any" 模式：任一人提交即完成（影子军团 — 主Agent代子Agent执行，只需一人提交）
        isStepComplete = true
      }
    }

    // 多人模式下未全部完成 → 记录部分提交，不改变步骤状态
    if (isMultiAssignee && !isStepComplete) {
      const sub = await prisma.stepSubmission.create({
        data: {
          stepId: id,
          submitterId: effectiveSubmitterId,  // 影子军团：记录实际执行的子 Agent
          result: resultText,
          summary: finalSummary || null,
          durationMs: agentDurationMs
        }
      })
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        await prisma.attachment.createMany({
          data: attachments.map((att: { name: string; url: string; type?: string }) => ({
            name: att.name, url: att.url, type: att.type || 'file',
            submissionId: sub.id, uploaderId: effectiveSubmitterId
          }))
        })
      }
      const done = allAssignees.filter(a => a.status === 'submitted' || a.userId === auth.userId).length
      console.log(`[Submit] 多人步骤 ${id} 部分提交: ${done}/${allAssignees.length}`)
      return NextResponse.json({
        message: `已提交你的部分（${done}/${allAssignees.length}），等待其他成员完成`,
        partial: true,
        progress: { done, total: allAssignees.length }
      })
    }

    const [submission, updated] = await prisma.$transaction(async (tx) => {
      const sub = await tx.stepSubmission.create({
        data: {
          stepId: id,
          submitterId: effectiveSubmitterId,  // 影子军团：记录实际执行的子 Agent，不是 Watch
          result: resultText,
          summary: finalSummary || null,
          durationMs: agentDurationMs
        }
      })

      // waitingForHuman: Agent 无法独立完成（缺少 API/授权/信息），需要人类提供后再继续
      // 优先级：waitingForHuman > 自动审批（防止"我需要帮助"被误判为成功）
      const isWaitingHuman = waitingForHuman === true
      const autoApprove = !isWaitingHuman && (step.status === 'waiting_human' || step.requiresApproval === false)
      const newStatus = isWaitingHuman ? 'waiting_human' : (autoApprove ? 'done' : 'waiting_approval')

      const upd = await tx.taskStep.update({
        where: { id },
        data: {
          status: newStatus,
          agentStatus: newStatus,
          result: resultText,
          summary: finalSummary || null,
          completedAt: now,
          reviewStartedAt: autoApprove ? null : now,
          approvedAt: autoApprove ? now : null,
          agentDurationMs,
          ...(metrics ? { agentMetrics: metrics as any } : {})
        }
      })

      // B08: 步骤完成时，更新所有 assignee 状态
      if (allAssignees.length > 0) {
        await tx.stepAssignee.updateMany({
          where: { stepId: id },
          data: { status: autoApprove ? 'done' : 'submitted' }
        })
      }

      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        await tx.attachment.createMany({
          data: attachments.map((att: { name: string; url: string; type?: string }) => ({
            name: att.name,
            url: att.url,
            type: att.type || 'file',
            submissionId: sub.id,
            uploaderId: auth.userId
          }))
        })
      }

      return [sub, upd]
    })

    // P1-C4: 异步生成 summary（不阻塞响应）
    if (!summary && result && result.length >= 20) {
      generateSummary({ stepTitle: step.title, result, attachmentCount: attachments?.length || 0 })
        .then(async (aiSummary) => {
          if (aiSummary) {
            await prisma.taskStep.update({ where: { id }, data: { summary: aiSummary } })
            await prisma.stepSubmission.update({ where: { id: submission.id }, data: { summary: aiSummary } })
            console.log(`[Summary] 异步更新步骤 ${id} 摘要: ${aiSummary}`)
          }
        })
        .catch(e => console.warn('[Summary] 异步摘要失败（非关键）:', e?.message))
    }

    // 更新 Agent 状态（影子军团：代提交时同时更新子 Agent 和主 Agent 的状态）
    if (isParentAgentSubmitting && effectiveSubmitterId !== auth.userId) {
      // 子 Agent 状态 → online（此步骤完成）
      await prisma.agent.updateMany({ where: { userId: effectiveSubmitterId }, data: { status: 'online' } })
    }
    const agent = await prisma.agent.findUnique({ where: { userId: auth.userId } })
    if (agent) await prisma.agent.update({ where: { userId: auth.userId }, data: { status: 'online' } })

    // 以实际更新后的状态判断是否自动通过（覆盖所有场景：requiresApproval=false / waiting_human 人类提交）
    const autoApproved = updated.status === 'done'

    if (waitingForHuman === true) {
      // Agent 标记"需要人类提供信息" → 通知任务创建者
      if (step.task.creatorId) {
        sendToUser(step.task.creatorId, {
          type: 'step:waiting-human',
          taskId: step.task.id,
          stepId: id,
          title: step.title,
          message: `⏸️ 步骤「${step.title}」需要你提供信息后才能继续`,
        })
        createNotification({
          userId: step.task.creatorId,
          type: 'step_assigned',
          title: `⏸️ 任务暂停，等待你的输入`,
          content: `步骤「${step.title}」需要你提供信息才能继续，请查看步骤描述`,
          taskId: step.task.id,
          stepId: id,
        }).catch(() => {})
      }
      console.log(`[Submit] ⏸️ 步骤 "${step.title}" 被 Agent 标记为需要人类输入 → waiting_human`)
    } else if (!autoApproved && step.task.creatorId) {
      sendToUser(step.task.creatorId, {
        type: 'approval:requested',
        taskId: step.task.id,
        stepId: id,
        title: step.title
      })
      const submitterName = (auth.user as any).name || (auth.user as any).email
      const template = notificationTemplates.stepWaiting(step.title, step.task.title, submitterName)
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.task.id,
        stepId: id
      })
    }

    sendToUser(auth.userId, {
      type: 'step:completed',
      taskId: step.task.id,
      stepId: id,
      title: step.title
    })

    // P2: 步骤实际完成（done）→ 检查父步骤自动完成 + 任务完成
    // 修复：之前只检查 requiresApproval === false，waiting_human 人类提交完成时也需要运行
    if (autoApproved) {
      const parentDone = await checkAndCompleteParentStep(id)
      if (parentDone) console.log(`[Submit/AutoApprove] 子步骤 ${id} → 父步骤自动完成`)

      // 检查任务是否全部步骤完成 → 自动标记任务为 done
      const remainingSteps = await prisma.taskStep.count({
        where: {
          taskId: step.taskId,
          status: { notIn: ['done', 'skipped'] }
        }
      })
      if (remainingSteps === 0) {
        const endTime = new Date().toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        })
        const taskFull = await prisma.task.findUnique({
          where: { id: step.taskId },
          select: { createdAt: true }
        })
        const startTime = taskFull?.createdAt
          ? taskFull.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—'
        const allDoneSteps = await prisma.taskStep.findMany({
          where: { taskId: step.taskId, status: 'done' },
          orderBy: { order: 'asc' },
          select: { title: true, agentDurationMs: true, humanDurationMs: true, agentMetrics: true }
        })
        // ── 军费统计聚合 ──
        // 优先使用 Watch 上报的真实 token（精确）；兜底用字符数估算（旧版兼容）
        const MODEL_PRICE_PER_M: Record<string, number> = {
          // Claude（输入+输出均价近似值，便于展示）
          'claude-opus-4': 45, 'claude-opus': 45,
          'claude-sonnet-4': 9, 'claude-sonnet-3-7': 9, 'claude-sonnet-3-5': 9, 'claude-sonnet': 9,
          'claude-haiku-3-5': 2, 'claude-haiku-3': 1.25, 'claude-haiku': 1.25,
          // OpenAI
          'gpt-4o-mini': 0.3, 'gpt-4o': 7.5, 'gpt-4-turbo': 30, 'gpt-4': 15, 'gpt-3.5': 1.5,
          // DeepSeek
          'deepseek-r1': 2, 'deepseek-chat': 0.5, 'deepseek': 0.5,
          // Gemini
          'gemini-2.0-flash': 0.5, 'gemini-1.5-pro': 5, 'gemini': 2,
        }
        function getModelPrice(modelName: string | null | undefined): { price: number; label: string } {
          if (!modelName) return { price: 9, label: '' }
          const lower = modelName.toLowerCase()
          for (const [key, price] of Object.entries(MODEL_PRICE_PER_M)) {
            if (lower.includes(key)) return { price, label: key.replace('claude-', '').replace('gpt-', 'GPT-') }
          }
          return { price: 9, label: '' }
        }

        let totalActualTokens = 0, totalPromptChars = 0, totalResultChars = 0, totalAgentMs = 0
        let agentStepCount = 0, humanStepCount = 0
        const modelTokenMap: Record<string, number> = {}

        for (const s of allDoneSteps) {
          const isHuman = !s.agentDurationMs && s.humanDurationMs
          if (isHuman) { humanStepCount++ }
          else {
            agentStepCount++
            totalAgentMs += s.agentDurationMs || 0
            const m = s.agentMetrics as any
            if (m) {
              // 真实 token 路径（新版 Watch 上报）
              if (m.promptTokens || m.completionTokens || m.totalTokens) {
                const t = m.totalTokens || (m.promptTokens || 0) + (m.completionTokens || 0)
                totalActualTokens += t
                const mdl = m.model || 'unknown'
                modelTokenMap[mdl] = (modelTokenMap[mdl] || 0) + t
              } else {
                // 字符估算兜底（旧版兼容）
                totalPromptChars += m.promptChars || 0
                totalResultChars += m.resultChars || 0
              }
            }
          }
        }

        // 计算费用
        let costLine = ''
        if (totalActualTokens > 0) {
          // 精确路径：用真实 token + 模型定价
          const dominantModel = Object.entries(modelTokenMap).sort(([,a],[,b]) => b - a)[0]?.[0] || null
          const { price: pricePerM, label: modelLabel } = getModelPrice(dominantModel)
          const estCostUSD = (totalActualTokens / 1_000_000 * pricePerM).toFixed(3)
          const modelSuffix = modelLabel ? `（${modelLabel}）` : ''
          costLine = `💰 军费：~${(totalActualTokens / 1000).toFixed(1)}K token，约 $${estCostUSD}${modelSuffix}`
        } else {
          // 兜底估算：字符数 / 1.5 ≈ token（中文）
          const totalChars = totalPromptChars + totalResultChars
          if (totalChars > 0) {
            const estTokens = Math.round(totalChars / 1.5)
            const estCostUSD = (estTokens / 1_000_000 * 9).toFixed(3)
            costLine = `💰 军费：~${(estTokens / 1000).toFixed(1)}K token，约 $${estCostUSD}`
          }
        }

        const totalChars = totalPromptChars + totalResultChars
        const estTokens = totalActualTokens > 0 ? totalActualTokens : Math.round(totalChars / 1.5)
        const agentMinutes = Math.round(totalAgentMs / 60000)
        const ratioLine = agentStepCount + humanStepCount > 0
          ? `🤖 人机比：Agent ${agentStepCount} 步 / 人类 ${humanStepCount} 步`
          : ''

        const autoSummary = [
          `开始：${startTime}`,
          `完成：${endTime}`,
          ratioLine,
          agentMinutes > 0 ? `⚡ Agent 执行：${agentMinutes} 分钟` : '',
          costLine,
          `产出物：${allDoneSteps.slice(0, 6).map(s => s.title).join('、')}`,
        ].filter(Boolean).join('\n')

        await prisma.task.update({
          where: { id: step.taskId },
          data: { status: 'done', autoSummary }
        })
        // 通知任务创建者
        if (step.task.creatorId) {
          sendToUser(step.task.creatorId, {
            type: 'task:completed',
            taskId: step.taskId,
            title: step.task.title
          })
          const template = notificationTemplates.taskCompleted(step.task.title)
          await createNotification({
            userId: step.task.creatorId,
            ...template,
            taskId: step.taskId
          })
        }
        console.log(`[Submit/AutoApprove] 任务 ${step.taskId} 全部步骤完成，已标记为 done`)

        // 🎓 课程任务完成 → 自动下发 Principle（submit 路由补全，approve 路由已有）
        try {
          const enrollment = await prisma.courseEnrollment.findFirst({
            where: { taskId: step.taskId, principleDelivered: false },
            include: { template: { select: { name: true, principleTemplate: true } } }
          })
          if (enrollment?.template?.principleTemplate) {
            const nowPrinciple = new Date()
            let principleData: any = null
            try {
              const parsed = JSON.parse(enrollment.template.principleTemplate)
              if (parsed.coreInsight || parsed.keyPrinciples || parsed.checklist) {
                principleData = parsed
              }
            } catch {
              principleData = {
                coreInsight: `完成课程「${enrollment.template.name}」`,
                keyPrinciples: [enrollment.template.principleTemplate],
                forbiddenList: [],
                checklist: []
              }
            }
            if (principleData) {
              await prisma.courseEnrollment.update({
                where: { id: enrollment.id },
                data: {
                  status: 'graduated',
                  principleDelivered: true,
                  principleDeliveredAt: nowPrinciple,
                  completedAt: nowPrinciple,
                }
              })
              sendToUser(enrollment.userId, {
                type: 'principle:received',
                enrollmentId: enrollment.id,
                courseName: enrollment.template.name,
                principleTemplate: principleData,
              })
              console.log(`[Submit/Course] Principle 已下发 userId=${enrollment.userId} 课程「${enrollment.template.name}」`)
            }
          }
        } catch (e: any) {
          console.warn('[Submit/Course] Principle 下发失败（非关键）:', e?.message)
        }
      }
    }

    // Issue 3 修复：只有步骤实际完成（done）时才推进下游工作流
    // waiting_approval / waiting_human 状态下不推进，下游等审批通过后由 approve API 触发
    let workflowResult = null
    if (autoApproved) {
      try {
        workflowResult = await processWorkflowAfterSubmit(id, result || '', summary)
      } catch (error) {
        console.error('[Submit] 工作流处理失败:', error)
      }
    }

    const responseBody = {
      message: autoApproved ? '已提交并自动通过（无需人工审核）' : '已提交，等待人类审核',
      autoApproved,
      step: updated,
      workflow: workflowResult
    }
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 'POST', `/api/steps/${id}/submit`, 200, responseBody)
    }
    return NextResponse.json(responseBody)

  } catch (error) {
    console.error('提交步骤失败:', error)
    return NextResponse.json({ error: '提交失败', detail: error instanceof Error ? error.message : '未知错误' }, { status: 500 })
  }
}

// getStartableSteps 已移至 @/lib/step-scheduling 共享模块
