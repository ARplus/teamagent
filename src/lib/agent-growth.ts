/**
 * 军团成长系统 (Phase 0)
 *
 * Agent 通过完成步骤、获得评分来积累经验值，经验值决定等级。
 * 等级影响任务分配权重和前端展示。
 */

import { prisma } from '@/lib/db'

// ── 等级阈值 ──
const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000] // Lv.1=0, Lv.2=100, Lv.3=300, Lv.4=600, Lv.5=1000

// ── XP 奖惩常量 ──
export const XP_STEP_APPROVED_CLEAN = 30   // 一次通过（0次打回）
export const XP_STEP_APPROVED_DIRTY = 15   // 有打回后通过
export const XP_STEP_REJECTED = -5         // 被打回
export const XP_EVAL_MULTIPLIER = 10       // 评分 overallScore × 10
export const XP_SUPER_BONUS = 50           // "超级八爪！" 评语奖励

// ── 纯计算函数（前后端共用逻辑）──

/** 根据 XP 计算等级 (1-5) */
export function calculateLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1
  }
  return 1
}

/** 等级称号 */
export function getLevelTitle(level: number): string {
  const titles = ['新兵', '列兵', '精英', '老兵', '传说']
  return titles[Math.min(level - 1, titles.length - 1)]
}

/** 下一等级所需 XP，Lv.5 返回 null */
export function getXPForNextLevel(level: number): number | null {
  if (level >= LEVEL_THRESHOLDS.length) return null
  return LEVEL_THRESHOLDS[level]
}

/** 当前等级内的进度百分比 (0-100) */
export function getLevelProgress(xp: number, level: number): number {
  const cur = LEVEL_THRESHOLDS[level - 1] || 0
  const next = LEVEL_THRESHOLDS[level]
  if (next == null || level >= LEVEL_THRESHOLDS.length) return 100
  const range = next - cur
  if (range <= 0) return 100
  return Math.min(100, Math.round(((xp - cur) / range) * 100))
}

// ── DB 操作 ──

/** userId → agentId（查找该用户绑定的 Agent） */
export async function findAgentByUserId(userId: string): Promise<string | null> {
  const agent = await prisma.agent.findFirst({
    where: { userId },
    select: { id: true }
  })
  return agent?.id ?? null
}

/**
 * 原子 XP 变更
 *
 * 用 prisma increment 做原子加减，防并发丢失。
 * XP 不会低于 0（先 increment 再 clamp）。
 * 等级从最新 XP 重新计算。
 */
export async function applyXPChange(
  agentId: string,
  xpDelta: number,
  reason: string,
): Promise<{ newXP: number; newLevel: number; oldLevel: number; leveledUp: boolean }> {
  // 1. 读当前等级
  const current = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { growthXP: true, growthLevel: true }
  })
  if (!current) {
    console.warn(`[Growth] Agent ${agentId} not found`)
    return { newXP: 0, newLevel: 1, oldLevel: 1, leveledUp: false }
  }

  const oldLevel = current.growthLevel

  // 2. 原子 increment
  let updated = await prisma.agent.update({
    where: { id: agentId },
    data: { growthXP: { increment: xpDelta } },
    select: { growthXP: true }
  })

  // 3. Clamp: XP 不低于 0
  if (updated.growthXP < 0) {
    updated = await prisma.agent.update({
      where: { id: agentId },
      data: { growthXP: 0 },
      select: { growthXP: true }
    })
  }

  // 4. 重算等级
  const newLevel = calculateLevel(updated.growthXP)
  if (newLevel !== oldLevel) {
    await prisma.agent.update({
      where: { id: agentId },
      data: { growthLevel: newLevel }
    })
  }

  const leveledUp = newLevel > oldLevel

  console.log(
    `[Growth] Agent ${agentId}: ${reason} → ${xpDelta > 0 ? '+' : ''}${xpDelta} XP` +
    ` (${updated.growthXP} total, Lv.${newLevel}${leveledUp ? ' ⬆️ LEVEL UP!' : ''})`
  )

  return { newXP: updated.growthXP, newLevel, oldLevel, leveledUp }
}
