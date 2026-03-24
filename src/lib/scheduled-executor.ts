/**
 * 模版执行器
 * 从 TaskTemplate 创建 Task + TaskSteps 并触发执行
 */

import { prisma } from './db'
import { sendToUser } from './events'
import { createNotification } from './notifications'
import { getStartableSteps, activateAndNotifySteps } from './step-scheduling'
import { computeNextRun } from './cron-utils'
import { resolveVariables } from './template-engine'

interface StepTemplate {
  title: string
  description?: string
  order: number
  stepType?: string
  assigneeId?: string
  assigneeType?: string
  requiresApproval?: boolean
  parallelGroup?: string | null
  inputs?: string[] | null
  outputs?: string[] | null
  skills?: string[] | null
}

export interface ExecutionResult {
  success: boolean
  taskId?: string
  instanceNumber?: number
  error?: string
}

/**
 * 执行定时模版：创建 Task + Steps + 激活
 */
export async function executeScheduledTemplate(templateId: string): Promise<ExecutionResult> {
  try {
    // 1. 加载模板
    const template = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
    })
    if (!template) {
      return { success: false, error: '模板不存在' }
    }
    if (!template.scheduleEnabled) {
      return { success: false, error: '模板已暂停' }
    }

    // 解析步骤模板
    let stepsTemplate: StepTemplate[]
    try {
      stepsTemplate = JSON.parse(template.stepsTemplate)
    } catch {
      return { success: false, error: '步骤模板 JSON 解析失败' }
    }
    if (!Array.isArray(stepsTemplate) || stepsTemplate.length === 0) {
      return { success: false, error: '步骤模板为空' }
    }

    const instanceNumber = template.runCount + 1
    const dateStr = new Date().toLocaleDateString('zh-CN', {
      month: 'numeric', day: 'numeric',
      timeZone: template.timezone,
    })

    // 解析变量默认值（定时任务无用户输入，用 defaultValue 替换模版名中的变量）
    let defaultVarMap: Record<string, string> = { TODAY: dateStr }
    try {
      const varDefs = JSON.parse(template.variables || '[]') as Array<{ name: string; defaultValue?: string }>
      for (const v of varDefs) {
        if (v.name && v.defaultValue) defaultVarMap[v.name] = v.defaultValue
      }
    } catch {}
    const titleBase = resolveVariables(template.name, defaultVarMap)

    // 2. 创建 Task 实例（V1.1: 零拆解）
    const task = await prisma.task.create({
      data: {
        title: `${titleBase} (#${instanceNumber} ${dateStr})`,
        description: template.description,
        status: 'todo',
        priority: 'medium',
        mode: 'solo',
        creatorId: template.creatorId,
        workspaceId: template.workspaceId,
        templateId: template.id,
        instanceNumber,
        decomposeStatus: 'done',
        decomposeEngine: 'template',
      },
    })

    // 3. V1.1: 创建 TaskSteps（executionProtocol 拼接到 description）
    const createdSteps: any[] = []
    for (let i = 0; i < stepsTemplate.length; i++) {
      const s = stepsTemplate[i]

      // 按 approvalMode 决定 requiresApproval
      let requiresApproval: boolean
      switch (template.approvalMode) {
        case 'auto':     requiresApproval = false; break
        case 'every':    requiresApproval = true; break
        case 'on_error': requiresApproval = false; break
        default:         requiresApproval = s.requiresApproval !== false
      }

      // V1.1: executionProtocol + description/promptTemplate 拼接
      let finalDesc = s.description || null
      if (template.executionProtocol && finalDesc) {
        finalDesc = `${template.executionProtocol}\n\n---\n\n## 本步骤任务\n\n${finalDesc}`
      } else if (template.executionProtocol) {
        finalDesc = template.executionProtocol
      }

      const step = await prisma.taskStep.create({
        data: {
          title: s.title,
          description: finalDesc,
          order: s.order ?? (i + 1),
          taskId: task.id,
          stepType: s.stepType || 'task',
          assigneeId: s.assigneeId || null,
          requiresApproval,
          parallelGroup: s.parallelGroup || null,
          inputs: s.inputs ? JSON.stringify(s.inputs) : null,
          outputs: s.outputs ? JSON.stringify(s.outputs) : null,
          skills: s.skills ? JSON.stringify(s.skills) : null,
          status: 'pending',
          agentStatus: s.assigneeId ? 'pending' : null,
        },
      })

      // 创建 StepAssignee 记录
      if (s.assigneeId) {
        let assigneeType = s.assigneeType || 'agent'
        if (!s.assigneeType) {
          const assigneeAgent = await prisma.agent.findUnique({
            where: { userId: s.assigneeId },
            select: { id: true },
          })
          if (!assigneeAgent) assigneeType = 'human'
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

    // 4. V1.1: 激活可执行的步骤（fromTemplate 标记）
    if (createdSteps.length > 0) {
      const startable = getStartableSteps(createdSteps)
      await activateAndNotifySteps(task.id, startable, { fromTemplate: true })
    }

    // 5. 更新模板统计
    const nextRunAt = template.schedule ? computeNextRun(template.schedule, template.timezone) : null
    await prisma.taskTemplate.update({
      where: { id: templateId },
      data: {
        runCount: instanceNumber,
        lastRunAt: new Date(),
        lastUsedAt: new Date(),
        nextRunAt,
        failCount: 0, // 成功执行重置失败计数
      },
    })

    // 6. 通知创建者
    sendToUser(template.creatorId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title,
    })
    await createNotification({
      userId: template.creatorId,
      type: 'task_assigned',
      title: '⏰ 定时任务执行',
      content: `定时任务「${template.name}」第 ${instanceNumber} 次执行已启动`,
      taskId: task.id,
    })

    console.log(`[Scheduled] ✅ 模板 "${template.name}" 第 ${instanceNumber} 次执行 → Task ${task.id}`)

    return { success: true, taskId: task.id, instanceNumber }

  } catch (error: any) {
    console.error(`[Scheduled] ❌ 模板 ${templateId} 执行失败:`, error)

    // 增加失败计数
    try {
      const template = await prisma.taskTemplate.findUnique({
        where: { id: templateId },
      })
      if (template) {
        const newFailCount = template.failCount + 1
        const shouldPause = newFailCount >= 3

        await prisma.taskTemplate.update({
          where: { id: templateId },
          data: {
            failCount: newFailCount,
            scheduleEnabled: shouldPause ? false : undefined,
          },
        })

        if (shouldPause) {
          console.warn(`[Scheduled] ⚠️ 模板 "${template.name}" 连续失败 ${newFailCount} 次，已自动暂停`)
          await createNotification({
            userId: template.creatorId,
            type: 'task_assigned',
            title: '⏰ 定时任务已暂停',
            content: `定时任务「${template.name}」因连续 ${newFailCount} 次失败已自动暂停`,
          })
          sendToUser(template.creatorId, {
            type: 'task:updated',
            taskId: templateId,
            title: `定时任务「${template.name}」已自动暂停`,
          })
        }
      }
    } catch (e2) {
      console.error('[Scheduled] 更新失败计数出错:', e2)
    }

    return { success: false, error: error?.message || '执行失败' }
  }
}

/**
 * 从已完成任务快照步骤模板
 */
export async function snapshotStepsFromTask(taskId: string): Promise<string> {
  const steps = await prisma.taskStep.findMany({
    where: { taskId, stepType: { not: 'decompose' } },
    include: {
      assignees: {
        select: { userId: true, assigneeType: true, isPrimary: true },
      },
    },
    orderBy: { order: 'asc' },
  })

  const template = steps.map(s => ({
    title: s.title,
    description: s.description,
    order: s.order,
    stepType: s.stepType,
    assigneeId: s.assigneeId,
    assigneeType: s.assignees?.[0]?.assigneeType || 'agent',
    requiresApproval: s.requiresApproval,
    parallelGroup: s.parallelGroup,
    inputs: s.inputs ? JSON.parse(s.inputs) : null,
    outputs: s.outputs ? JSON.parse(s.outputs) : null,
    skills: s.skills ? JSON.parse(s.skills) : null,
  }))

  return JSON.stringify(template)
}
