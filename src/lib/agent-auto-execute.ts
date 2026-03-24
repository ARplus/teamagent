/**
 * Agent 自动执行引擎
 *
 * 当步骤被激活（step:ready）且 assignee 是 Agent 时，
 * 自动完成 claim → AI 执行 → submit 流程。
 *
 * - Fire-and-forget：不阻塞步骤通知流程
 * - 防竞态：原子 updateMany + status guard
 * - 并发限制：简易 semaphore，默认最多 3 个 AI 调用同时进行
 * - 仅用 Qwen（Claude 从腾讯云被墙）
 */

import { prisma } from './db'
import { sendToUser } from './events'
import { processWorkflowAfterSubmit } from './workflow-engine'
import { createNotification, notificationTemplates } from './notifications'
import { generateSummary } from './ai-summary'

// ─── 配置 ───────────────────────────────────────────────
const AUTO_EXECUTE_ENABLED = process.env.AUTO_EXECUTE_ENABLED !== 'false' // 默认开启
const MAX_CONCURRENT = parseInt(process.env.AUTO_EXECUTE_CONCURRENCY || '3')
const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// ─── 简易 Semaphore ─────────────────────────────────────
let running = 0
function acquireSlot(): boolean {
  if (running >= MAX_CONCURRENT) return false
  running++
  return true
}
function releaseSlot() { running = Math.max(0, running - 1) }

// ─── 主入口 ─────────────────────────────────────────────

/**
 * 尝试自动执行一个步骤（fire-and-forget）
 * 内部会判断是否是 Agent 步骤，人类步骤自动跳过
 */
export async function tryAutoExecuteStep(stepId: string, taskId: string): Promise<void> {
  if (!AUTO_EXECUTE_ENABLED) return
  if (!QWEN_API_KEY) {
    console.log('[AutoExec] 无 QWEN_API_KEY，跳过自动执行')
    return
  }

  try {
    // P1-1 fix: 延迟 2s，让客户端 SSE 先收到 approval:rejected 并 dedup，避免竞态
    await new Promise(r => setTimeout(r, 2000))

    // 1. 查步骤完整信息（含全量上下文：所有步骤、评论、打回历史）
    const step = await prisma.taskStep.findUnique({
      where: { id: stepId },
      include: {
        task: {
          select: {
            id: true, title: true, description: true, creatorId: true, mode: true,
            // 全部步骤（用于步骤总览 + 前序产出）
            steps: {
              orderBy: { order: 'asc' },
              select: {
                id: true, order: true, title: true, status: true,
                assigneeId: true, parallelGroup: true, stepType: true,
                result: true, summary: true,
                assignees: { select: { assigneeType: true, user: { select: { name: true, nickname: true, agent: { select: { name: true } } } } } }
              }
            }
          }
        },
        // 当前步骤的评论
        comments: {
          orderBy: { createdAt: 'asc' },
          select: {
            content: true, createdAt: true,
            author: { select: { name: true, nickname: true } }
          }
        },
        // 完整提交/打回历史
        submissions: {
          orderBy: { createdAt: 'asc' },
          select: { result: true, status: true, reviewNote: true, createdAt: true }
        },
        assignees: { select: { assigneeType: true, user: { select: { name: true, nickname: true, agent: { select: { name: true } } } } } }
      }
    })

    if (!step || step.status !== 'pending') return

    // P1-1 fix: 打回次数 >= 3 时不再自动执行，通知人类介入
    if ((step.rejectionCount ?? 0) >= 3) {
      console.log(`[AutoExec] ⚠️ 步骤 "${step.title}" 已被打回 ${step.rejectionCount} 次，需要人类介入`)
      if (step.task.creatorId) {
        sendToUser(step.task.creatorId, {
          type: 'step:needs-human',
          taskId,
          stepId,
          title: step.title,
          reason: `步骤已被打回 ${step.rejectionCount} 次，AI 无法自动修正，请人工处理`
        })
        await createNotification({
          userId: step.task.creatorId,
          type: 'step_rejected',
          title: `步骤「${step.title}」需要人工介入（已打回 ${step.rejectionCount} 次）`,
          content: `AI 无法自动修正，请人工处理`,
          taskId,
          stepId
        })
      }
      return
    }

    // 2. 全面禁用服务端千问自动执行 — 所有步骤由真实 Agent Watch 领取和执行
    console.log(`[AutoExec] ⏭️ 步骤 "${step.title}" 跳过服务端自动执行（已禁用，等待真实 Agent Watch）`)
    return

  } catch (error) {
    console.error(`[AutoExec] ❌ 步骤 ${stepId} 错误:`, error)
  }
}

// ─── 内部函数 ───────────────────────────────────────────

/**
 * 判断步骤是否应由 Agent 自动执行，返回 Agent 的 userId
 */
async function resolveAgentUserId(stepId: string, assigneeId: string | null): Promise<string | null> {
  // 优先查 StepAssignee 表
  const assignees = await prisma.stepAssignee.findMany({
    where: { stepId },
    select: { userId: true, assigneeType: true }
  })

  if (assignees.length > 0) {
    // 有 StepAssignee 记录 → 看 assigneeType
    const agentAssignee = assignees.find(a => a.assigneeType === 'agent')
    if (agentAssignee) return agentAssignee.userId
    // 全是 human → 不自动执行
    return null
  }

  // 无 StepAssignee 记录 → 用 assigneeId 判断
  if (!assigneeId) return null

  const agent = await prisma.agent.findUnique({
    where: { userId: assigneeId },
    select: { userId: true }
  })

  return agent ? agent.userId : null
}

/**
 * 原子领取步骤（防竞态）
 */
async function claimStepInternal(stepId: string, agentUserId: string): Promise<boolean> {
  // 原子更新：只在 pending 状态时才领取
  const result = await prisma.taskStep.updateMany({
    where: { id: stepId, status: 'pending' },
    data: {
      assigneeId: agentUserId,
      status: 'in_progress',
      agentStatus: 'working',
      startedAt: new Date()
    }
  })

  if (result.count === 0) return false // 已被领取

  // 更新 StepAssignee 状态
  await prisma.stepAssignee.updateMany({
    where: { stepId, userId: agentUserId },
    data: { status: 'in_progress' }
  })

  // 更新 Agent 状态
  await prisma.agent.updateMany({
    where: { userId: agentUserId },
    data: { status: 'working' }
  })

  return true
}

/**
 * 构建 AI 执行 prompt（全量上下文版）
 */
function buildExecutionPrompt(
  step: {
    order: number; title: string; description: string | null
    inputs: string | null; outputs: string | null; skills: string | null
    rejectionReason: string | null; rejectedAt: Date | null; rejectionCount: number | null
    parallelGroup: string | null
    comments?: { content: string; createdAt: Date; author: { name: string | null; nickname: string | null } }[]
    submissions?: { result: string; status: string; reviewNote: string | null; createdAt: Date }[]
    assignees?: { assigneeType: string; user: { name: string | null; nickname: string | null; agent: { name: string } | null } }[]
  },
  task: {
    title: string; description: string | null
    steps: {
      id: string; order: number; title: string; status: string
      parallelGroup: string | null
      assignees?: { assigneeType: string; user: { name: string | null; nickname: string | null; agent: { name: string } | null } }[]
      result: string | null; summary: string | null
    }[]
  }
): string {
  const parts: string[] = []

  parts.push(`你是 TeamAgent 中的 AI Agent，正在执行一个任务步骤。`)

  // ── 分配者信息（谁做的拆解 + 为什么分给你） ──────────────
  const decomposeStep = task.steps.find(s => (s as any).stepType === 'decompose')
  if (decomposeStep) {
    const decomposerNames = ((decomposeStep as any).assignees || []).map((a: any) => {
      const u = a.user
      return a.assigneeType === 'agent' ? (u.agent?.name || u.name) : (u.nickname || u.name)
    }).filter(Boolean)
    if (decomposerNames.length > 0) {
      parts.push('')
      parts.push(`## 分配来源`)
      parts.push(`- 任务拆解者：${decomposerNames.join('、')}`)
      if (step.skills) {
        try {
          const skills = JSON.parse(step.skills)
          if (skills.length > 0) parts.push(`- 分配给你的原因：此步骤匹配你的能力标签「${skills.join('、')}」`)
        } catch {}
      }
      parts.push(`- 请基于你的能力完成此步骤，如能力不足请在提交中说明并请求支援`)
    }
  }

  // ── 打回历史前置（强制重视）──────────────────────────────
  const rejectedSubmissions = (step.submissions || []).filter(s => s.status === 'rejected')
  if (rejectedSubmissions.length > 0) {
    parts.push('')
    parts.push(`## ⚠️ 此步骤已被打回 ${rejectedSubmissions.length} 次，必须针对性修改`)
    rejectedSubmissions.forEach((s, i) => {
      parts.push(`### 第 ${i + 1} 次打回`)
      parts.push(`- 打回原因：${s.reviewNote || '未填写原因'}`)
      parts.push(`- 当时提交内容：${s.result.slice(0, 500)}${s.result.length > 500 ? '...(已截断)' : ''}`)
    })
    parts.push(`\n你必须：1) 仔细阅读每次打回原因；2) 针对性修改，确保与上次不同；3) 无法理解时在提交中说明困难。`)
    parts.push('')
  }

  // ── 任务基本信息 ─────────────────────────────────────────
  parts.push('')
  parts.push(`## 任务信息`)
  parts.push(`- 任务：${task.title}`)
  if (task.description) parts.push(`- 描述：${task.description}`)

  // ── 步骤总览（全量，让 Agent 知道自己在哪） ──────────────
  parts.push('')
  parts.push(`## 步骤总览（共 ${task.steps.length} 步）`)
  for (const s of task.steps) {
    const assigneeName = (s.assignees || []).map(a => {
      const u = a.user
      return a.assigneeType === 'agent' ? (u.agent?.name || u.name) : (u.nickname || u.name)
    }).filter(Boolean).join('、') || '未分配'
    const parallelNote = s.parallelGroup ? ` [并行组:${s.parallelGroup}]` : ''
    const isCurrent = s.order === step.order ? ' ← 当前步骤' : ''
    parts.push(`- 步骤${s.order}「${s.title}」 负责人:${assigneeName} 状态:${s.status}${parallelNote}${isCurrent}`)
  }

  // ── 并行说明 ─────────────────────────────────────────────
  if (step.parallelGroup) {
    const parallelPeers = task.steps.filter(
      s => s.parallelGroup === step.parallelGroup && s.order !== step.order
    )
    if (parallelPeers.length > 0) {
      parts.push('')
      parts.push(`## ⚡ 并行任务说明`)
      parts.push(`本步骤与以下步骤【并行执行】，各自独立完成，请勿重复对方的工作：`)
      parallelPeers.forEach(p => parts.push(`- 步骤${p.order}「${p.title}」（状态:${p.status}）`))
    }
  }

  // ── 当前步骤详情 ─────────────────────────────────────────
  parts.push('')
  parts.push(`## 当前步骤`)
  parts.push(`- 步骤 ${step.order}: ${step.title}`)
  if (step.description) parts.push(`- 描述：${step.description}`)
  if (step.inputs) {
    try { parts.push(`- 需要的输入：${JSON.parse(step.inputs).join('、')}`) } catch { parts.push(`- 需要的输入：${step.inputs}`) }
  }
  if (step.outputs) {
    try { parts.push(`- 期望的产出：${JSON.parse(step.outputs).join('、')}`) } catch { parts.push(`- 期望的产出：${step.outputs}`) }
  }
  if (step.skills) {
    try { parts.push(`- 需要的技能：${JSON.parse(step.skills).join('、')}`) } catch { parts.push(`- 需要的技能：${step.skills}`) }
  }

  // ── 步骤评论（人类/其他 Agent 留言） ─────────────────────
  const comments = step.comments || []
  if (comments.length > 0) {
    parts.push('')
    parts.push(`## 步骤评论（${comments.length} 条）`)
    comments.forEach(c => {
      const author = c.author.nickname || c.author.name || '匿名'
      parts.push(`- [${author}]: ${c.content}`)
    })
  }

  // ── 前序步骤产出 ─────────────────────────────────────────
  const previousOutputs = task.steps.filter(s => s.order < step.order && s.status === 'done')
  if (previousOutputs.length > 0) {
    parts.push('')
    parts.push(`## 前序步骤产出（你的输入依赖）`)
    for (const p of previousOutputs) {
      const content = p.result || p.summary || '（无产出）'
      // 截断过长的前序结果，避免 prompt 爆炸
      const truncated = content.length > 2000 ? content.slice(0, 2000) + '...(已截断)' : content
      parts.push(`### 步骤${p.order}「${p.title}」`)
      parts.push(truncated)
    }
  }

  // ── 执行规范 ────────────────────────────────────────────
  parts.push('')
  parts.push(`## 执行规范（必须遵守）`)
  parts.push(`1. 优先调用已有 Skill，不重新实现`)
  parts.push(`2. 若 Skill 需要 Token/Key/登录，在提交中注明，等人类单独回复后再继续`)
  parts.push(`3. 提交时必须附可验证的输出（文件路径、命令结果、截图或 URL），不能只写"已完成"`)
  parts.push(`4. 同一操作失败超过 2 次，停止并写明错误和卡点，等人类判断`)
  parts.push(`5. 步骤有依赖时，确认上一步结果后再执行，不跳过`)
  parts.push(`6. 任务描述明确要求提交附件，或产出物为文件/图片/视频/报告时，提交时必须附上实际附件（文件路径或 URL），不可仅用文字描述代替`)

  parts.push('')
  if (rejectedSubmissions.length > 0) {
    parts.push(`## 要求`)
    parts.push(`请根据上方打回历史重新完成，产出必须与之前不同。直接输出你的工作成果。`)
  } else {
    parts.push(`## 要求`)
    parts.push(`请认真完成这个步骤，产出高质量的结果。直接输出你的工作成果，不要输出多余的说明。`)
  }

  return parts.join('\n')
}

/**
 * 调用千问 AI
 */
async function callQwenAI(prompt: string): Promise<string> {
  const response = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`
    },
    body: JSON.stringify({
      model: 'qwen3-max',
      messages: [
        { role: 'system', content: '你是一个专业的 AI 助手，正在协助完成团队任务。请直接输出工作成果，不要输出多余的客套话。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 8192
    }),
    signal: AbortSignal.timeout(120_000) // 120s 超时
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`千问 API 错误 ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('千问 API 返回空内容')

  return content
}

/**
 * 内部提交步骤结果
 */
async function submitResultInternal(
  stepId: string,
  agentUserId: string,
  result: string,
  step: {
    title: string
    order: number
    requiresApproval: boolean | null
    startedAt: Date | null
    task: { id: string; title: string; creatorId: string; description: string | null }
  }
): Promise<void> {
  const now = new Date()
  const agentDurationMs = step.startedAt ? now.getTime() - new Date(step.startedAt).getTime() : null

  // 自动生成 summary
  let finalSummary: string | null = null
  try {
    const aiSummary = await generateSummary({
      stepTitle: step.title,
      result: result,
      attachmentCount: 0
    })
    if (aiSummary) finalSummary = aiSummary
  } catch {
    // summary 生成失败不影响提交
  }

  const autoApprove = step.requiresApproval === false
  const newStatus = autoApprove ? 'done' : 'waiting_approval'

  // 事务：创建 submission + 更新步骤
  await prisma.$transaction(async (tx) => {
    await tx.stepSubmission.create({
      data: {
        stepId,
        submitterId: agentUserId,
        result,
        summary: finalSummary,
        durationMs: agentDurationMs
      }
    })

    await tx.taskStep.update({
      where: { id: stepId },
      data: {
        status: newStatus,
        agentStatus: newStatus,
        result,
        summary: finalSummary,
        completedAt: now,
        reviewStartedAt: autoApprove ? null : now,
        approvedAt: autoApprove ? now : null,
        agentDurationMs
      }
    })

    // 更新所有 assignee 状态
    await tx.stepAssignee.updateMany({
      where: { stepId },
      data: { status: autoApprove ? 'done' : 'submitted' }
    })
  })

  // 更新 Agent 状态
  await prisma.agent.updateMany({
    where: { userId: agentUserId },
    data: { status: 'online' }
  })

  // 通知
  if (!autoApprove && step.task.creatorId) {
    sendToUser(step.task.creatorId, {
      type: 'approval:requested',
      taskId: step.task.id,
      stepId,
      title: step.title
    })

    // 查 Agent 名字
    const agentUser = await prisma.user.findUnique({
      where: { id: agentUserId },
      select: { name: true, email: true }
    })
    const submitterName = agentUser?.name || agentUser?.email || 'Agent'

    const template = notificationTemplates.stepWaiting(step.title, step.task.title, submitterName)
    await createNotification({
      userId: step.task.creatorId,
      ...template,
      taskId: step.task.id,
      stepId
    })
  }

  // 通知 Agent 自己（步骤完成）
  sendToUser(agentUserId, {
    type: 'step:completed',
    taskId: step.task.id,
    stepId,
    title: step.title
  })

  // 触发工作流引擎（推进下一批步骤）
  try {
    await processWorkflowAfterSubmit(stepId, result, finalSummary || undefined)
  } catch (error) {
    console.error('[AutoExec] 工作流引擎处理失败:', error)
  }

  // 自动审批时检查任务是否全部完成
  if (autoApprove) {
    await checkAndCompleteTask(step.task.id, step.task.creatorId, step.task.title)
  }
}

/**
 * 检查任务是否全部完成，如果是则标记任务 done + 生成摘要
 */
async function checkAndCompleteTask(taskId: string, creatorId: string, taskTitle: string): Promise<void> {
  try {
    const remainingSteps = await prisma.taskStep.count({
      where: { taskId, status: { notIn: ['done', 'skipped'] } }
    })

    if (remainingSteps > 0) return

    // 所有步骤完成 — 更新时间统计
    const allSteps = await prisma.taskStep.findMany({
      where: { taskId },
      select: { agentDurationMs: true, humanDurationMs: true, status: true, title: true, order: true }
    })

    const totalAgentTimeMs = allSteps.reduce((sum, s) => sum + (s.agentDurationMs || 0), 0)
    const totalHumanTimeMs = allSteps.reduce((sum, s) => sum + (s.humanDurationMs || 0), 0)
    const totalTime = totalAgentTimeMs + totalHumanTimeMs
    const agentWorkRatio = totalTime > 0 ? totalAgentTimeMs / totalTime : null

    // 生成自动摘要
    const taskFull = await prisma.task.findUnique({
      where: { id: taskId },
      select: { createdAt: true }
    })
    const startTime = taskFull?.createdAt
      ? taskFull.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—'
    const endTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

    const outputs = allSteps
      .filter(s => s.status === 'done')
      .sort((a, b) => a.order - b.order)
      .slice(0, 6)
      .map(s => s.title)

    const autoSummary = [
      `开始：${startTime}`,
      `完成：${endTime}`,
      `产出物：${outputs.join('、')}`,
    ].join('\n')

    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'done', autoSummary, totalAgentTimeMs, totalHumanTimeMs, agentWorkRatio }
    })

    // 通知任务创建者
    sendToUser(creatorId, {
      type: 'task:updated',
      taskId,
      title: taskTitle
    })

    const template = notificationTemplates.taskCompleted(taskTitle)
    await createNotification({
      userId: creatorId,
      ...template,
      taskId
    })

    console.log(`[AutoExec] 🎉 任务 "${taskTitle}" 全部完成`)
  } catch (error) {
    console.error('[AutoExec] 任务完成检测失败:', error)
  }
}
