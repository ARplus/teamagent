/**
 * TeamAgent 动态工作流引擎
 * 
 * 在步骤完成时：
 * 1. 检查产出物是否符合预期
 * 2. 决定是否需要调整后续步骤
 * 3. 执行调整（插入/修改/跳过）
 * 4. 通知相关 Agent
 */

import { prisma } from './db'
import { sendToUsers } from './events'

const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// 工作流调整类型
export type WorkflowAdjustment = 
  | { type: 'none'; reason: string }
  | { type: 'insert_step'; afterStepId: string; newStep: NewStepData; reason: string }
  | { type: 'modify_step'; stepId: string; changes: Partial<StepChanges>; reason: string }
  | { type: 'skip_step'; stepId: string; reason: string }

interface NewStepData {
  title: string
  description: string
  assignees: string[]
  inputs: string[]
  outputs: string[]
  skills: string[]
}

interface StepChanges {
  title: string
  description: string
  assignees: string[]
}

interface WorkflowCheckResult {
  needsAdjustment: boolean
  adjustments: WorkflowAdjustment[]
  nextStepReady: boolean
  nextStepId?: string
}

const WORKFLOW_CHECK_PROMPT = `你是 TeamAgent 工作流引擎。检查刚完成的步骤，决定是否需要调整后续工作流。

## 输入
- 已完成步骤的信息（标题、描述、产出物、结果）
- 后续待执行的步骤列表

## 输出格式（JSON）
{
  "needsAdjustment": false,
  "adjustments": [],
  "analysis": "简短分析"
}

或者需要调整时：
{
  "needsAdjustment": true,
  "adjustments": [
    {
      "type": "insert_step",
      "afterStepId": "当前步骤ID",
      "newStep": {
        "title": "新步骤标题",
        "description": "详细描述",
        "assignees": ["负责人"],
        "inputs": ["输入"],
        "outputs": ["产出"],
        "skills": ["技能"]
      },
      "reason": "为什么需要插入"
    }
  ],
  "analysis": "分析说明"
}

## 调整类型
1. insert_step: 在某步骤后插入新步骤（发现缺少必要环节）
2. modify_step: 修改某步骤的内容（根据产出调整）
3. skip_step: 跳过某步骤（已不需要）

## 判断规则
- 产出物与预期不符 → 可能需要插入修正步骤
- 产出物超出预期 → 可能可以跳过后续某些步骤
- 产出物揭示新需求 → 可能需要插入新步骤
- 正常完成 → needsAdjustment: false

保守判断，只在明确需要时才调整。输出纯 JSON。`

/**
 * 检查工作流是否需要调整
 */
export async function checkWorkflow(
  completedStepId: string,
  result: string,
  summary?: string
): Promise<WorkflowCheckResult> {
  try {
    // 获取完成的步骤及其任务
    const completedStep = await prisma.taskStep.findUnique({
      where: { id: completedStepId },
      include: {
        task: {
          include: {
            steps: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    })

    if (!completedStep) {
      return { needsAdjustment: false, adjustments: [], nextStepReady: false }
    }

    // 找到后续步骤
    const remainingSteps = completedStep.task.steps.filter(
      s => s.order > completedStep.order && s.status === 'pending'
    )

    // 如果没有后续步骤，不需要检查
    if (remainingSteps.length === 0) {
      return { needsAdjustment: false, adjustments: [], nextStepReady: false }
    }

    // 找到下一个步骤
    const nextStep = remainingSteps[0]

    // 构建上下文
    const context = `
## 已完成的步骤
- ID: ${completedStep.id}
- 标题: ${completedStep.title}
- 描述: ${completedStep.description || '无'}
- 预期产出: ${completedStep.outputs || '[]'}
- 实际结果: ${result}
- 摘要: ${summary || '无'}

## 后续待执行步骤
${remainingSteps.map((s, i) => `
${i + 1}. [${s.id}] ${s.title}
   描述: ${s.description || '无'}
   需要输入: ${s.inputs || '[]'}
   预期产出: ${s.outputs || '[]'}
`).join('\n')}
`

    // 调用 AI 检查（只在有足够上下文时）
    if (!QWEN_API_KEY) {
      console.log('[Workflow] 无 AI Key，跳过智能检查')
      return {
        needsAdjustment: false,
        adjustments: [],
        nextStepReady: true,
        nextStepId: nextStep.id
      }
    }

    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen-turbo', // 用快速模型，降低延迟
        messages: [
          { role: 'system', content: WORKFLOW_CHECK_PROMPT },
          { role: 'user', content: context }
        ],
        temperature: 0.2
      })
    })

    if (!response.ok) {
      console.error('[Workflow] AI 检查失败')
      return {
        needsAdjustment: false,
        adjustments: [],
        nextStepReady: true,
        nextStepId: nextStep.id
      }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    let checkResult
    try {
      checkResult = JSON.parse(content)
    } catch {
      console.error('[Workflow] AI 返回格式错误')
      return {
        needsAdjustment: false,
        adjustments: [],
        nextStepReady: true,
        nextStepId: nextStep.id
      }
    }

    console.log('[Workflow] AI 检查结果:', checkResult.analysis)

    return {
      needsAdjustment: checkResult.needsAdjustment || false,
      adjustments: checkResult.adjustments || [],
      nextStepReady: true,
      nextStepId: nextStep.id
    }

  } catch (error) {
    console.error('[Workflow] 检查失败:', error)
    return { needsAdjustment: false, adjustments: [], nextStepReady: false }
  }
}

/**
 * 应用工作流调整
 */
export async function applyAdjustments(
  taskId: string,
  adjustments: WorkflowAdjustment[]
): Promise<{ applied: number; changes: string[] }> {
  const changes: string[] = []
  let applied = 0

  for (const adj of adjustments) {
    try {
      switch (adj.type) {
        case 'insert_step': {
          // 获取当前步骤的 order
          const afterStep = await prisma.taskStep.findUnique({
            where: { id: adj.afterStepId }
          })
          if (!afterStep) continue

          // 后移后续步骤的 order
          await prisma.taskStep.updateMany({
            where: {
              taskId,
              order: { gt: afterStep.order }
            },
            data: {
              order: { increment: 1 }
            }
          })

          // 插入新步骤
          const newStep = await prisma.taskStep.create({
            data: {
              taskId,
              title: adj.newStep.title,
              description: adj.newStep.description,
              order: afterStep.order + 1,
              status: 'pending',
              assigneeNames: JSON.stringify(adj.newStep.assignees),
              inputs: JSON.stringify(adj.newStep.inputs),
              outputs: JSON.stringify(adj.newStep.outputs),
              skills: JSON.stringify(adj.newStep.skills)
            }
          })

          changes.push(`插入步骤: ${newStep.title} (${adj.reason})`)
          applied++
          break
        }

        case 'modify_step': {
          const updateData: Record<string, unknown> = {}
          if (adj.changes.title) updateData.title = adj.changes.title
          if (adj.changes.description) updateData.description = adj.changes.description
          if (adj.changes.assignees) {
            updateData.assigneeNames = JSON.stringify(adj.changes.assignees)
          }

          await prisma.taskStep.update({
            where: { id: adj.stepId },
            data: updateData
          })

          changes.push(`修改步骤: ${adj.stepId} (${adj.reason})`)
          applied++
          break
        }

        case 'skip_step': {
          await prisma.taskStep.update({
            where: { id: adj.stepId },
            data: {
              status: 'skipped',
              result: `自动跳过: ${adj.reason}`
            }
          })

          changes.push(`跳过步骤: ${adj.stepId} (${adj.reason})`)
          applied++
          break
        }
      }
    } catch (error) {
      console.error(`[Workflow] 应用调整失败:`, adj, error)
    }
  }

  // 记录工作流变更历史
  if (applied > 0) {
    // TODO: 保存到 WorkflowHistory 表
    console.log(`[Workflow] 应用了 ${applied} 项调整:`, changes)
  }

  return { applied, changes }
}

/**
 * 通知下一步的 Agent
 */
export async function notifyNextStep(
  taskId: string,
  nextStepId: string
): Promise<void> {
  const nextStep = await prisma.taskStep.findUnique({
    where: { id: nextStepId },
    include: {
      task: { select: { title: true } },
      assignee: { select: { id: true } }
    }
  })

  if (!nextStep?.assignee) {
    console.log('[Workflow] 下一步没有负责人，不发通知')
    return
  }

  sendToUsers([nextStep.assignee.id], {
    type: 'step:ready',
    taskId,
    stepId: nextStepId,
    title: nextStep.title
  })

  console.log(`[Workflow] 已通知 ${nextStep.assignee.id}: ${nextStep.title} 可以开始`)
}

/**
 * 完整的工作流处理流程
 */
export async function processWorkflowAfterSubmit(
  completedStepId: string,
  result: string,
  summary?: string
): Promise<{
  checked: boolean
  adjusted: boolean
  adjustments: string[]
  nextStepNotified: boolean
}> {
  // 1. 检查工作流
  const checkResult = await checkWorkflow(completedStepId, result, summary)

  // 2. 应用调整（如果需要）
  let adjustmentResult = { applied: 0, changes: [] as string[] }
  if (checkResult.needsAdjustment && checkResult.adjustments.length > 0) {
    const step = await prisma.taskStep.findUnique({
      where: { id: completedStepId },
      select: { taskId: true }
    })
    if (step) {
      adjustmentResult = await applyAdjustments(step.taskId, checkResult.adjustments)
    }
  }

  // 3. 通知下一步（如果有）
  let notified = false
  if (checkResult.nextStepReady && checkResult.nextStepId) {
    const step = await prisma.taskStep.findUnique({
      where: { id: completedStepId },
      select: { taskId: true }
    })
    if (step) {
      await notifyNextStep(step.taskId, checkResult.nextStepId)
      notified = true
    }
  }

  return {
    checked: true,
    adjusted: adjustmentResult.applied > 0,
    adjustments: adjustmentResult.changes,
    nextStepNotified: notified
  }
}
