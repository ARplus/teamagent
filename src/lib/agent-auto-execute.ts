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
    // 1. 查步骤完整信息
    const step = await prisma.taskStep.findUnique({
      where: { id: stepId },
      include: {
        task: {
          select: {
            id: true, title: true, description: true, creatorId: true,
            steps: {
              where: { status: 'done' },
              orderBy: { order: 'asc' },
              select: { order: true, title: true, result: true, summary: true }
            }
          }
        }
      }
    })

    if (!step || step.status !== 'pending') return

    // 2. 判断是否是 Agent 步骤
    const agentUserId = await resolveAgentUserId(stepId, step.assigneeId)
    if (!agentUserId) {
      // 人类步骤或未分配，跳过
      return
    }

    console.log(`[AutoExec] 🤖 开始自动执行步骤 "${step.title}" (${stepId})`)

    // 3. 获取并发槽位
    if (!acquireSlot()) {
      console.log(`[AutoExec] ⏳ 并发已满(${MAX_CONCURRENT})，步骤 "${step.title}" 留在 pending 等待`)
      return
    }

    try {
      // 4. 原子领取
      const claimed = await claimStepInternal(stepId, agentUserId)
      if (!claimed) {
        console.log(`[AutoExec] 步骤 "${step.title}" 已被其他人领取，跳过`)
        return
      }

      // 5. 构建 prompt + 调用 AI
      const previousOutputs = step.task.steps.filter(s => s.order < step.order)
      const prompt = buildExecutionPrompt(step, step.task, previousOutputs)

      console.log(`[AutoExec] 🧠 调用千问 AI 执行步骤 "${step.title}"...`)
      const result = await callQwenAI(prompt)
      console.log(`[AutoExec] ✅ AI 返回结果 (${result.length} 字)`)

      // 6. 提交结果
      await submitResultInternal(stepId, agentUserId, result, step)

      console.log(`[AutoExec] 📤 步骤 "${step.title}" 已自动提交`)

    } finally {
      releaseSlot()
    }

  } catch (error) {
    releaseSlot() // 确保释放
    console.error(`[AutoExec] ❌ 步骤 ${stepId} 自动执行失败:`, error)
    // 不 reset 步骤状态——留在 in_progress 让人类介入
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
 * 构建 AI 执行 prompt
 */
function buildExecutionPrompt(
  step: { order: number; title: string; description: string | null; inputs: string | null; outputs: string | null; skills: string | null; rejectionReason: string | null; rejectedAt: Date | null },
  task: { title: string; description: string | null },
  previousOutputs: { order: number; title: string; result: string | null; summary: string | null }[]
): string {
  const parts: string[] = []

  parts.push(`你是 TeamAgent 中的 AI Agent，正在执行一个任务步骤。请认真完成这个步骤，产出高质量的结果。`)
  parts.push('')
  parts.push(`## 任务信息`)
  parts.push(`- 任务：${task.title}`)
  if (task.description) parts.push(`- 描述：${task.description}`)
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

  // 前序步骤产出
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

  // 打回重做
  if (step.rejectionReason && step.rejectedAt) {
    parts.push('')
    parts.push(`## ⚠️ 注意：此步骤之前被打回`)
    parts.push(`打回原因：${step.rejectionReason}`)
    parts.push(`请根据打回原因修改你的产出，确保这次能通过审核。`)
  }

  parts.push('')
  parts.push(`## 要求`)
  parts.push(`请认真完成这个步骤。直接输出你的工作成果，不要输出多余的说明。`)

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
      model: 'qwen-max-latest',
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

  // 触发工作流引擎
  try {
    await processWorkflowAfterSubmit(stepId, result, finalSummary || undefined)
  } catch (error) {
    console.error('[AutoExec] 工作流引擎处理失败:', error)
  }
}
