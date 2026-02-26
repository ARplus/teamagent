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

interface StepLike {
  id: string
  order: number
  parallelGroup: string | null
  status: string
  assigneeId: string | null
  title: string
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
 * - 并行组内步骤完成：检查组内是否全部完成
 *   - 全部完成 → 推进到下一批
 *   - 未全部完成 → 等待，不推进
 * - 顺序步骤完成：直接推进到下一批
 */
export function getNextStepsAfterCompletion<T extends StepLike>(
  allSteps: T[],
  completedStep: T
): T[] {
  const sorted = [...allSteps].sort((a, b) => a.order - b.order)
  const pg = completedStep.parallelGroup

  if (pg) {
    // 并行组：检查组内是否全部完成
    const groupSteps = sorted.filter(s => s.parallelGroup === pg)
    const allGroupDone = groupSteps.every(
      s => s.status === 'done' || s.status === 'skipped'
    )
    if (!allGroupDone) return [] // 组内还有未完成的，不推进

    // 全组完成，找组后面的待执行步骤
    const maxGroupOrder = Math.max(...groupSteps.map(s => s.order))
    const remaining = sorted.filter(
      s => s.order > maxGroupOrder && s.status === 'pending'
    )
    return getStartableSteps(remaining)
  }

  // 顺序步骤：找后面的待执行步骤
  const remaining = sorted.filter(
    s => s.order > completedStep.order && s.status === 'pending'
  )
  return getStartableSteps(remaining)
}

/**
 * 激活并通知一批步骤（设置 agentStatus + 发送 step:ready SSE）
 */
export async function activateAndNotifySteps(
  taskId: string,
  steps: StepLike[]
): Promise<number> {
  let notified = 0
  for (const s of steps) {
    if (s.assigneeId) {
      await prisma.taskStep.update({
        where: { id: s.id },
        data: { agentStatus: 'pending' }
      })
      sendToUser(s.assigneeId, {
        type: 'step:ready',
        taskId,
        stepId: s.id,
        title: s.title
      })
      notified++
    }
  }
  if (notified > 0) {
    console.log(
      `[StepScheduling] 激活 ${notified} 个步骤: ${steps.map(s => s.title).join(', ')}`
    )
  }
  return notified
}
