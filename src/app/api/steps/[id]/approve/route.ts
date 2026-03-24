import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'
import { getNextStepsAfterCompletion, activateAndNotifySteps, checkAndCompleteParentStep } from '@/lib/step-scheduling'
import { applyXPChange, findAgentByUserId, XP_STEP_APPROVED_CLEAN, XP_STEP_APPROVED_DIRTY } from '@/lib/agent-growth'
import { authenticateRequest } from '@/lib/api-auth'

// POST /api/steps/[id]/approve - 审核通过（支持人类 session 和 Agent token）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 统一鉴权：Agent token 优先，fallback session
    let user: { id: string; name: string | null; email: string } | null = null
    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      user = tokenAuth.user
    } else {
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
      }
      user = await prisma.user.findUnique({ where: { email: session.user.email } })
    }

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // B08: 权限检查 — 任务创建者 or 步骤负责人 or StepAssignee 成员
    const isAssignee = await prisma.stepAssignee.findFirst({ where: { stepId: id, userId: user.id } })
    if (step.task.creatorId !== user.id && step.assigneeId !== user.id && !isAssignee) {
      return NextResponse.json({ error: '无权审核此步骤' }, { status: 403 })
    }

    // 检查状态
    if (step.status !== 'waiting_approval') {
      return NextResponse.json({ error: '步骤未在等待审核状态' }, { status: 400 })
    }

    // 计算人类审批时间
    const now = new Date()
    const humanDurationMs = step.reviewStartedAt
      ? now.getTime() - new Date(step.reviewStartedAt).getTime()
      : null

    // 1. 更新最新的 submission 状态为 approved
    const latestSubmission = await prisma.stepSubmission.findFirst({
      where: { stepId: id, status: 'pending' },
      orderBy: { createdAt: 'desc' }
    })

    if (latestSubmission) {
      await prisma.stepSubmission.update({
        where: { id: latestSubmission.id },
        data: {
          status: 'approved',
          reviewedAt: now,
          reviewedBy: user.id
        }
      })
    }

    // 2. 更新步骤状态
    // 注意：completedAt 不在这里更新——它在 submit 时已记录 Agent 提交时间，审批不应覆盖
    const updated = await prisma.taskStep.update({
      where: { id },
      data: {
        status: 'done',
        agentStatus: null,
        approvedAt: now,
        approvedBy: user.id,
        humanDurationMs
      }
    })

    // B08: 批量更新所有 StepAssignee 为 done
    await prisma.stepAssignee.updateMany({
      where: { stepId: id },
      data: { status: 'done' }
    })

    // 🆕 Growth: 审核通过 → 奖励 XP
    if (step.assigneeId) {
      try {
        const agentId = await findAgentByUserId(step.assigneeId)
        if (agentId) {
          const xp = (step.rejectionCount ?? 0) > 0 ? XP_STEP_APPROVED_DIRTY : XP_STEP_APPROVED_CLEAN
          const result = await applyXPChange(agentId, xp, `approved:${step.title}`)
          if (result.leveledUp) {
            sendToUser(step.assigneeId, {
              type: 'agent:level-up',
              agentId,
              newLevel: result.newLevel,
              oldLevel: result.oldLevel,
              totalXP: result.newXP,
            })
          }
        }
      } catch (e: any) {
        console.warn('[Approve/Growth] XP 奖励失败:', e?.message)
      }
    }

    // 更新任务的总时间统计
    const allSteps = await prisma.taskStep.findMany({
      where: { taskId: step.taskId },
      select: { agentDurationMs: true, humanDurationMs: true }
    })
    
    const totalAgentTimeMs = allSteps.reduce((sum, s) => sum + (s.agentDurationMs || 0), 0)
    const totalHumanTimeMs = allSteps.reduce((sum, s) => sum + (s.humanDurationMs || 0), 0)
    const totalTime = totalAgentTimeMs + totalHumanTimeMs
    const agentWorkRatio = totalTime > 0 ? totalAgentTimeMs / totalTime : null

    // 审批门控：pre_check 步骤通过后，解锁任务对所有参与方可见
    const approvalGateUpdate = step.stepType === 'pre_check' ? { isApproved: true } : {}

    await prisma.task.update({
      where: { id: step.taskId },
      data: { totalAgentTimeMs, totalHumanTimeMs, agentWorkRatio, ...approvalGateUpdate }
    })

    // P2: 子步骤完成后，检查是否可以自动完成父步骤
    const parentCompleted = await checkAndCompleteParentStep(id)
    if (parentCompleted) {
      console.log(`[Approve] 子步骤 ${id} 完成 → 父步骤自动完成`)
    }

    // 检查下一批可启动的步骤（parallelGroup 感知）
    // 如果当前步骤在并行组中，需要等组内全部完成才推进
    const allTaskSteps = await prisma.taskStep.findMany({
      where: { taskId: step.taskId },
      orderBy: { order: 'asc' }
    })
    const completedStepData = allTaskSteps.find(s => s.id === id)!
    const nextSteps = getNextStepsAfterCompletion(
      allTaskSteps as any[],
      { ...completedStepData, status: 'done' } as any  // 刚更新为 done
    )
    await activateAndNotifySteps(step.taskId, nextSteps as any[])

    // 🔔 通知当前步骤负责人：已审核通过
    if (step.assigneeId) {
      sendToUser(step.assigneeId, {
        type: 'approval:granted',
        taskId: step.taskId,
        stepId: step.id
      })
      // 同时发 step:approved（Watch 可监听此事件后 poll 新步骤）
      sendToUser(step.assigneeId, {
        type: 'step:approved',
        taskId: step.taskId,
        stepId: step.id,
        title: step.title,
      })
      
      // 站内信通知
      const template = notificationTemplates.stepApproved(step.title, user.name || user.email)
      await createNotification({
        userId: step.assigneeId,
        ...template,
        taskId: step.taskId,
        stepId: step.id
      })
    }

    // 检查任务是否全部完成
    const remainingSteps = await prisma.taskStep.count({
      where: {
        taskId: step.taskId,
        status: { notIn: ['done', 'skipped'] }
      }
    })

    if (remainingSteps === 0) {
      // 任务完成 — 生成自动摘要
      const allDoneSteps = await prisma.taskStep.findMany({
        where: { taskId: step.taskId },
        include: { assignee: { select: { name: true } } },
        orderBy: { order: 'asc' },
        // agentMetrics 通过 include 自动返回（Json? 字段）
      })
      
      // 统计参与成员（去重）
      const members = [...new Set(
        allDoneSteps
          .map(s => s.assignee?.name)
          .filter(Boolean)
      )]

      // 格式化时间
      const fmtTime = (ms: number | null) => {
        if (!ms) return '—'
        const h = Math.floor(ms / 3600000)
        const m = Math.floor((ms % 3600000) / 60000)
        return h > 0 ? `${h}h ${m}m` : `${m}m`
      }

      const finalTask = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { totalAgentTimeMs: true, totalHumanTimeMs: true, agentWorkRatio: true }
      })

      const agentPct = finalTask?.agentWorkRatio != null
        ? `${Math.round(finalTask.agentWorkRatio * 100)}%`
        : '—'
      const humanPct = finalTask?.agentWorkRatio != null
        ? `${Math.round((1 - finalTask.agentWorkRatio) * 100)}%`
        : '—'

      const doneCount = allDoneSteps.filter(s => s.status === 'done').length
      const skippedCount = allDoneSteps.filter(s => s.status === 'skipped').length

      // 取开始时间（最早步骤的 startedAt 或任务创建时间）
      const taskFull = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { createdAt: true }
      })
      const startTime = taskFull?.createdAt
        ? taskFull.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—'
      const endTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

      // 产出物：done 步骤的标题（最多 6 个）
      const outputs = allDoneSteps
        .filter(s => s.status === 'done')
        .slice(0, 6)
        .map(s => s.title)

      // 军费统计（与 submit 路由保持一致）
      const MODEL_PRICE_APPROVE: Record<string, number> = {
        'claude-opus-4': 45, 'claude-opus': 45,
        'claude-sonnet-4': 9, 'claude-sonnet-3-7': 9, 'claude-sonnet-3-5': 9, 'claude-sonnet': 9,
        'claude-haiku-3-5': 2, 'claude-haiku-3': 1.25, 'claude-haiku': 1.25,
        'gpt-4o-mini': 0.3, 'gpt-4o': 7.5, 'gpt-4': 15, 'gpt-3.5': 1.5,
        'deepseek-r1': 2, 'deepseek-chat': 0.5, 'deepseek': 0.5,
        'gemini-2.0-flash': 0.5, 'gemini-1.5-pro': 5, 'gemini': 2,
      }
      let totalActualTokens = 0, totalPromptChars = 0, totalResultChars = 0
      const modelTokenMapApprove: Record<string, number> = {}
      for (const s of allDoneSteps) {
        const m = (s as any).agentMetrics as any
        if (m) {
          if (m.promptTokens || m.completionTokens || m.totalTokens) {
            const t = m.totalTokens || (m.promptTokens || 0) + (m.completionTokens || 0)
            totalActualTokens += t
            const mdl = m.model || 'unknown'
            modelTokenMapApprove[mdl] = (modelTokenMapApprove[mdl] || 0) + t
          } else {
            totalPromptChars += m.promptChars || 0
            totalResultChars += m.resultChars || 0
          }
        }
      }
      let costLine = ''
      if (totalActualTokens > 0) {
        const dominantModel = Object.entries(modelTokenMapApprove).sort(([,a],[,b]) => b - a)[0]?.[0] || null
        const lower = (dominantModel || '').toLowerCase()
        let price = 9, label = ''
        for (const [key, p] of Object.entries(MODEL_PRICE_APPROVE)) {
          if (lower.includes(key)) { price = p; label = key.replace('claude-', '').replace('gpt-', 'GPT-'); break }
        }
        const estCost = (totalActualTokens / 1_000_000 * price).toFixed(3)
        costLine = `💰 军费：~${(totalActualTokens / 1000).toFixed(1)}K token，约 $${estCost}${label ? `（${label}）` : ''}`
      } else {
        const totalChars = totalPromptChars + totalResultChars
        if (totalChars > 0) {
          const estTok = Math.round(totalChars / 1.5)
          costLine = `💰 军费：~${(estTok / 1000).toFixed(1)}K token，约 $${(estTok / 1_000_000 * 9).toFixed(3)}`
        }
      }

      const autoSummary = [
        `开始：${startTime}`,
        `完成：${endTime}`,
        costLine,
        `产出物：${outputs.join('、')}`,
      ].filter(Boolean).join('\n')

      await prisma.task.update({
        where: { id: step.taskId },
        data: { status: 'done', autoSummary }
      })
      
      // 通知任务创建者任务已完成
      const template = notificationTemplates.taskCompleted(step.task.title)
      await createNotification({
        userId: step.task.creatorId,
        ...template,
        taskId: step.taskId
      })
    }

    // 🎓 课程任务完成 → 自动下发 Principle（补全缺失链路）
    if (remainingSteps === 0) {
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
              // 兼容旧版 Skill（只认 principleContent 字符串）
              principleContent: JSON.stringify(principleData, null, 2),
            })
            console.log(`[Approve/Course] 课程任务完成 → Principle 已下发给学员 userId=${enrollment.userId}，课程「${enrollment.template.name}」`)
          }
        }
      } catch (e: any) {
        console.warn('[Approve/Course] Principle 下发失败（非关键）:', e?.message)
      }
    }

    // 如果任务完成，读取 autoSummary 返回给前端
    let taskAutoSummary: string | null = null
    if (remainingSteps === 0) {
      const completedTask = await prisma.task.findUnique({
        where: { id: step.taskId },
        select: { autoSummary: true }
      })
      taskAutoSummary = completedTask?.autoSummary ?? null
    }

    return NextResponse.json({
      message: '审核通过',
      step: updated,
      nextSteps: nextSteps.map(s => ({
        id: s.id,
        title: s.title,
        assigneeId: s.assigneeId
      })),
      taskCompleted: remainingSteps === 0,
      autoSummary: taskAutoSummary
    })

  } catch (error) {
    console.error('审核失败:', error)
    return NextResponse.json({ error: '审核失败' }, { status: 500 })
  }
}
