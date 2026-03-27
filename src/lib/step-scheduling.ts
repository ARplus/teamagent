/**
 * 步骤调度工具
 * 统一处理 parallelGroup 并行步骤的启动和推进逻辑
 *
 * 规则：
 * - parallelGroup 相同的步骤可以同时执行
 * - parallelGroup 为 null 的步骤是顺序步骤，必须等前面全部完成
 * - 一个并行组全部完成后，才能推进到下一批步骤
 */

import { prisma } from './db'
import { sendToUser } from './events'
import { createNotification, notificationTemplates } from './notifications'

interface StepLike {
  id: string
  order: number
  parallelGroup: string | null
  status: string
  assigneeId: string | null
  title: string
  stepType?: string
  // B08: 可选多人指派
  assignees?: { userId: string }[]
}

/**
 * 从一组待执行步骤中，找出可以立即开始的步骤
 *
 * - 从 order 最小的开始扫描
 * - 遇到并行步骤（parallelGroup 非 null）：该组 ALL 成员都可以开始
 * - 遇到顺序步骤（parallelGroup 为 null）：只有它可以开始，后续全部等待
 * - 多个并行组在顺序步骤之前，全部可以同时开始
 *
 * 旧代码的 bug：每个并行组只取第一个成员，导致同组其他步骤永远 pending
 */
export function getStartableSteps<T extends StepLike>(steps: T[]): T[] {
  if (steps.length === 0) return []

  const sorted = [...steps].sort((a, b) => a.order - b.order)

  // 第一个是顺序步骤 → 只有它可以开始
  if (!sorted[0].parallelGroup) {
    return [sorted[0]]
  }

  // 收集所有并行步骤，直到遇到第一个顺序步骤
  const startable: T[] = []
  for (const s of sorted) {
    if (!s.parallelGroup) break // 遇到顺序屏障，停止
    startable.push(s)
  }

  return startable.length > 0 ? startable : [sorted[0]]
}

/**
 * 步骤完成（done/skipped）后，计算下一批可启动的步骤
 *
 * 规则：
 * - 并行组内步骤完成：检查【所有并行组+顺序步骤】在当前 order 之前是否全部完成
 *   - 全部完成 → 推进到下一批
 *   - 未全部完成 → 等待，不推进
 * - 顺序步骤完成：检查 order 之前的所有步骤是否全完成，全完成才推进
 * - waiting_human 步骤：视为阻断屏障，下游全部不推进
 *
 * Bug#5 修复要点：
 * 原逻辑只检查 order ≤ maxGroupOrder 的其他步骤，
 * 但"maxGroupOrder"可能小于其他并行组的 order，导致漏判。
 * 新逻辑：统一找到当前完成的步骤（或组）之后的第一个"屏障"，
 * 检查屏障之前的所有步骤是否全部完成，才推进。
 */
export function getNextStepsAfterCompletion<T extends StepLike>(
  allSteps: T[],
  completedStep: T
): T[] {
  const sorted = [...allSteps].sort((a, b) => a.order - b.order)
  const pg = completedStep.parallelGroup

  // 计算"当前完成波次"的最大 order
  // - 并行步骤：取整个并行组的最大 order
  // - 顺序步骤：就是自己的 order
  let completedWaveMaxOrder: number
  if (pg) {
    const groupSteps = sorted.filter(s => s.parallelGroup === pg)
    completedWaveMaxOrder = Math.max(...groupSteps.map(s => s.order))

    // 组内还有未完成的步骤，不推进
    const allGroupDone = groupSteps.every(
      s => s.status === 'done' || s.status === 'skipped'
    )
    if (!allGroupDone) return []
  } else {
    completedWaveMaxOrder = completedStep.order
  }

  // Bug#5 核心修复：检查 order ≤ completedWaveMaxOrder 的【所有】步骤是否完成
  // 同组的兄弟步骤（parallelGroup === pg）上面已经判断过，这里跳过避免重复
  // 但其他组（包括其他并行组和顺序步骤）必须全部 done/skipped 才推进
  const prerequisitesUnfinished = sorted.filter(s => {
    if (s.order > completedWaveMaxOrder) return false       // 不是前置
    if (pg && s.parallelGroup === pg) return false          // 同组，上面已判断
    return s.status !== 'done' && s.status !== 'skipped'
  })
  if (prerequisitesUnfinished.length > 0) return [] // 仍有前置未完成

  // 所有前置完成，找当前波次之后的步骤
  const afterWave = sorted.filter(s => s.order > completedWaveMaxOrder)

  // waiting_human 屏障：下一个步骤已在等人类输入，不再往后推
  if (afterWave[0]?.status === 'waiting_human') return []

  const remaining = afterWave.filter(s => s.status === 'pending')
  return getStartableSteps(remaining)
}

/**
 * 激活并通知一批步骤（设置 agentStatus + 发送 step:ready SSE）
 * B08: 同时通知所有 StepAssignee 用户
 * V1.1: fromTemplate 标记模版零拆解步骤
 */
export async function activateAndNotifySteps(
  taskId: string,
  steps: StepLike[],
  options?: { fromTemplate?: boolean; templateName?: string }
): Promise<number> {
  let notified = 0
  // 提前查一次 taskTitle，供 DB 通知使用
  const taskInfo = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, creatorId: true, mode: true } })
  const taskTitle = taskInfo?.title || '（未知任务）'
  const taskMode = taskInfo?.mode || 'solo'

  for (const s of steps) {
    // P0-1 fix: 收集 userId → assigneeType 映射，让客户端知道该步骤对该用户是 human 还是 agent
    const userTypeMap = new Map<string, string>()
    if (s.assigneeId) userTypeMap.set(s.assigneeId, 'auto')

    // B08: 查询 StepAssignee 表获取所有被分配者 + assigneeType
    if (!s.assignees) {
      const stepAssignees = await prisma.stepAssignee.findMany({
        where: { stepId: s.id },
        select: { userId: true, assigneeType: true }
      })
      for (const sa of stepAssignees) userTypeMap.set(sa.userId, sa.assigneeType || 'auto')
    } else {
      for (const sa of s.assignees) userTypeMap.set(sa.userId, (sa as any).assigneeType || 'auto')
    }

    // 'auto' 兜底：查一下没有 StepAssignee 记录的 userId 是否有 agent
    // 有 agent → 'agent'；无 agent（纯人类用户）→ 'human'
    const autoEntries = [...userTypeMap.entries()].filter(([, t]) => t === 'auto')
    if (autoEntries.length > 0) {
      const autoUserIds = autoEntries.map(([uid]) => uid)
      const agentsForUsers = await prisma.agent.findMany({
        where: { userId: { in: autoUserIds } },
        select: { userId: true }
      })
      const userIdsWithAgent = new Set(agentsForUsers.map(a => a.userId))
      for (const [uid] of autoEntries) {
        userTypeMap.set(uid, userIdsWithAgent.has(uid) ? 'agent' : 'human')
      }
    }

    // waiting_human: 如果所有 assignee 都是 human，进入专属等待状态
    const allHuman = userTypeMap.size > 0 && [...userTypeMap.values()].every(t => t === 'human')
    if (allHuman) {
      // 设置步骤状态为 waiting_human（专属阻断状态）
      await prisma.taskStep.update({
        where: { id: s.id },
        data: { status: 'waiting_human', agentStatus: 'waiting_human' }
      })

      // 通知任务创建者（SSE 消息 + DB 通知 — 比普通铃铛更显眼）
      if (taskInfo?.creatorId) {
        // SSE: 专属事件，前端可弹窗/高亮
        sendToUser(taskInfo.creatorId, {
          type: 'step:waiting-human',
          taskId,
          stepId: s.id,
          title: s.title,
          message: `⏸️ 任务卡在「${s.title}」，需要你提供内容后才能继续`,
        })
        // DB 通知（铃铛 + 醒目文案）
        createNotification({
          userId: taskInfo.creatorId,
          type: 'step_assigned',
          title: `⏸️ 任务暂停，等待你的输入`,
          content: `任务「${taskTitle}」的步骤「${s.title}」需要你提供内容，完成后后续步骤才会继续`,
          taskId,
          stepId: s.id,
        }).catch(() => {})
      }

      // 同时通知 human assignee（让其知道需要在这个步骤提交内容）
      for (const [uid] of userTypeMap) {
        sendToUser(uid, {
          type: 'step:ready',
          taskId,
          stepId: s.id,
          title: s.title,
          assigneeType: 'human',
          ...(options?.fromTemplate ? { fromTemplate: true } : {}),
        })
      }

      console.log(`[StepScheduling] ⏸️ 步骤 "${s.title}" 需要人类输入 → waiting_human`)
      notified++
      continue
    }

    if (userTypeMap.size > 0) {
      await prisma.taskStep.update({
        where: { id: s.id },
        data: { agentStatus: 'pending' }
      })
      for (const [uid, assigneeType] of userTypeMap) {
        if (assigneeType === 'agent') {
          // ③ Bug2 fix: 提前查 agent 信息（soul + parentAgentId），覆盖所有 agent 路径
          const agentInfo = await prisma.agent.findUnique({
            where: { userId: uid },
            select: { id: true, name: true, soul: true, parentAgentId: true }
          }).catch(() => null)

          // 1. SSE 实时推送（带 assigneeSoul，让 Watch 知道用哪个人格执行）
          sendToUser(uid, {
            type: 'step:ready',
            taskId,
            stepId: s.id,
            title: s.title,
            assigneeType: 'agent',
            assigneeName: agentInfo?.name || undefined,
            assigneeSoul: agentInfo?.soul || undefined,
            taskMode,
            ...(s.stepType ? { stepType: s.stepType } : {}),
            ...(options?.fromTemplate ? { fromTemplate: true } : {}),
            ...(options?.templateName ? { templateName: options.templateName } : {}),
          } as any)

          // 影子军团：若分配给子 Agent，额外通知主 Agent 代为执行（带 assigneeSoul）
          // 使用 step:delegated（区别于 step:ready），Watch 监听此事件开 isolated session
          if (agentInfo?.parentAgentId) {
            const parentAgent = await prisma.agent.findUnique({
              where: { id: agentInfo.parentAgentId },
              select: { userId: true }
            }).catch(() => null)
            if (parentAgent?.userId && parentAgent.userId !== uid) {
              sendToUser(parentAgent.userId, {
                type: 'step:delegated',   // Watch handleStepDelegated → isolated session，不注入 main session
                taskId,
                stepId: s.id,
                title: s.title,
                assigneeType: 'agent',
                assigneeName: agentInfo.name,
                assigneeSoul: agentInfo.soul || undefined,
                assigneeUserId: uid,      // 子 Agent 的 userId（Watch claim/submit 用自己 token + onBehalfOf）
                isDelegated: true,
                taskMode,                 // Team 模式传递，parent Watch 可据此决策执行方式
                ...(s.stepType ? { stepType: s.stepType } : {}),
                ...(options?.fromTemplate ? { fromTemplate: true } : {}),
                ...(options?.templateName ? { templateName: options.templateName } : {}),
              } as any)
            }
          }
        } else {
          // 1. SSE 实时推送（human 步骤，不需要 soul）
          sendToUser(uid, {
            type: 'step:ready',
            taskId,
            stepId: s.id,
            title: s.title,
            assigneeType,
            ...(s.stepType ? { stepType: s.stepType } : {}),
            ...(options?.fromTemplate ? { fromTemplate: true } : {}),
            ...(options?.templateName ? { templateName: options.templateName } : {}),
          })
        }

        // 2. DB 持久化通知（SSE 离线/断线时的兜底，通知铃铛可查）
        createNotification({
          userId: uid,
          ...notificationTemplates.stepAssigned(s.title, taskTitle),
          taskId,
          stepId: s.id,
        }).catch(() => {}) // fire-and-forget，不阻塞
      }
      notified++
    } else {
      // 步骤无 assignee：通知任务创建者，让人工处理或重新分配
      if (taskInfo?.creatorId) {
        sendToUser(taskInfo.creatorId, {
          type: 'step:unassigned',
          taskId,
          stepId: s.id,
          title: s.title,
          message: `步骤「${s.title}」无法分配负责人，请手动指派或 claim`,
        })
        // DB 持久化通知（SSE 断线时不丢失）
        createNotification({
          userId: taskInfo.creatorId,
          type: 'task_assigned',
          title: `⚠️ 步骤「${s.title}」无人认领`,
          content: `任务「${taskTitle}」的步骤「${s.title}」没有匹配到执行者，请手动指派或 claim`,
          taskId,
          stepId: s.id,
        }).catch(() => {})
      }
      console.log(`[StepScheduling] ⚠️ 步骤 "${s.title}" 无 assignee，已通知创建者`)
    }
  }
  if (notified > 0) {
    console.log(
      `[StepScheduling] 激活 ${notified} 个步骤: ${steps.map(s => s.title).join(', ')}`
    )
  }

  // 🤖 自动执行：对 Agent 类型的步骤触发 auto-execute（fire-and-forget）
  // 用动态 import 打破循环依赖: step-scheduling → agent-auto-execute → workflow-engine → step-scheduling
  import('./agent-auto-execute').then(({ tryAutoExecuteStep }) => {
    for (const s of steps) {
      tryAutoExecuteStep(s.id, taskId).catch(err => {
        console.error(`[AutoExec] 步骤 ${s.id} 自动执行触发失败:`, err)
      })
    }
  }).catch(err => {
    console.error('[AutoExec] 动态加载 agent-auto-execute 失败:', err)
  })

  return notified
}

/**
 * P2: 子步骤全部完成后，自动完成父步骤
 *
 * 调用时机：子步骤变为 done 后（approve / auto-approve submit）
 * 返回：父步骤是否被自动完成
 */
export async function checkAndCompleteParentStep(childStepId: string): Promise<boolean> {
  const childStep = await prisma.taskStep.findUnique({
    where: { id: childStepId },
    select: { parentStepId: true, taskId: true }
  })
  if (!childStep?.parentStepId) return false

  // 查所有同父子步骤
  const siblings = await prisma.taskStep.findMany({
    where: { parentStepId: childStep.parentStepId },
    select: { id: true, status: true, result: true, title: true }
  })

  const allDone = siblings.every(s => s.status === 'done' || s.status === 'skipped')
  if (!allDone) return false

  // 汇总子步骤产出
  const doneCount = siblings.filter(s => s.status === 'done').length
  const summaryLines = siblings
    .filter(s => s.status === 'done' && s.result)
    .map(s => `- **${s.title}**: ${(s.result || '').slice(0, 100)}`)
    .join('\n')

  const now = new Date()
  await prisma.taskStep.update({
    where: { id: childStep.parentStepId },
    data: {
      status: 'done',
      agentStatus: 'done',
      result: `✅ 所有 ${siblings.length} 个子步骤已完成（${doneCount} done）\n\n${summaryLines}`,
      completedAt: now,
      approvedAt: now,
    }
  })

  // 更新 StepAssignee
  await prisma.stepAssignee.updateMany({
    where: { stepId: childStep.parentStepId },
    data: { status: 'done' }
  })

  console.log(`[StepExpansion] 父步骤 ${childStep.parentStepId} 自动完成 (${siblings.length} 个子步骤全部done)`)
  return true
}
