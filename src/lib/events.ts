/**
 * TeamAgent 事件系统
 * 使用 Server-Sent Events (SSE) 实现实时通知
 * v2.0: 统一事件包络（A2A 协议对齐）
 */

import { encodeDualStackSSE, type EnvelopeOptions } from './event-envelope'

// 事件类型定义
export type TeamAgentEvent = 
  | { type: 'task:created'; taskId: string; title: string; fromTemplate?: boolean; templateName?: string }
  | { type: 'task:updated'; taskId: string; title: string }
  | { type: 'step:ready'; taskId: string; stepId: string; title: string; stepType?: string; taskDescription?: string; assigneeType?: string; fromTemplate?: boolean; templateName?: string; decomposePrompt?: string }
  | { type: 'step:completed'; taskId: string; stepId: string; title: string; nextStepId?: string }
  | { type: 'task:decomposed'; taskId: string; stepsCount: number }
  | { type: 'step:assigned'; taskId: string; stepId: string; title: string }
  | { type: 'approval:requested'; taskId: string; stepId: string; title: string }
  | { type: 'approval:granted'; taskId: string; stepId: string }
  | { type: 'approval:rejected'; taskId: string; stepId: string; reason?: string }
  | { type: 'workflow:changed'; taskId: string; change: string }
  | { type: 'step:appealed'; taskId: string; stepId: string; title: string; appealText: string }
  | { type: 'appeal:resolved'; taskId: string; stepId: string; decision: 'upheld' | 'dismissed'; note?: string }
  | { type: 'chat:incoming'; msgId: string; content: string; agentId: string }
  | { type: 'step:commented'; taskId: string; stepId: string; commentId: string; authorName: string }
  | { type: 'task:evaluating'; taskId: string; title: string; agentName: string }
  | { type: 'task:evaluated'; taskId: string; title: string; count: number; reviewerName?: string }
  | { type: 'step:mentioned'; taskId: string; stepId: string; commentId: string; authorId: string; authorName: string; content: string }
  // Agent 上线/离线广播
  | { type: 'agent:online'; agentId: string; agentName: string; userId: string }
  | { type: 'agent:offline'; agentId: string; agentName: string; userId: string }
  // F06: Agent 主动呼叫
  | { type: 'agent:calling'; callId: string; priority: 'urgent' | 'normal' | 'low'; title: string; content: string; agentName: string; taskId?: string; stepId?: string }
  | { type: 'agent:call-responded'; callId: string; action: string; message?: string; respondedBy: string }
  // B04: AI 后台拆解完成
  | { type: 'task:parsed'; taskId: string; stepCount: number; engine: string }
  // 可插拔拆解：请求主Agent拆解任务
  | { type: 'task:decompose-request'; taskId: string; taskTitle: string; taskDescription: string; mode?: 'solo' | 'team'; supplement?: string;
      teamMembers: { name: string; isAgent: boolean; agentName?: string; capabilities?: string[]; role?: string; soulSummary?: string; level?: number }[];
      decomposePrompt?: string }
  // BYOA：广播拆解，任意在线 Agent 可接单
  | { type: 'task:decompose-available'; taskId: string; stepId: string; taskTitle: string; taskDescription: string; supplement?: string;
      teamMembers: { name: string; isAgent: boolean; agentName?: string; capabilities?: string[]; role?: string; soulSummary?: string; level?: number }[];
      decomposePrompt?: string }
  // BYOA：有 Agent 接单拆解通知
  | { type: 'task:decompose-claimed'; taskId: string; agentName: string }
  // BYOA：等待 Agent 上线通知
  | { type: 'task:waiting-agent'; taskId: string; taskTitle: string; agentName: string; mode: 'solo' | 'team' }
  // BYOA：广播超时无人接单
  | { type: 'task:decompose-failed'; taskId: string; taskTitle: string; reason: string }
  // 任务完成
  | { type: 'task:completed'; taskId: string; title: string }
  // 步骤无人认领（通知创建者手工处理）
  | { type: 'step:unassigned'; taskId: string; stepId: string; title: string; message: string }
  // 🆕 军团成长：Agent 升级
  | { type: 'agent:level-up'; agentId: string; newLevel: number; oldLevel: number; totalXP: number }
  // 定时任务
  | { type: 'scheduled:triggered'; templateId: string; taskId: string; instanceNumber: number }
  // 日程提醒
  | { type: 'schedule:reminder'; eventId: string; title: string; emoji: string; startAt: string; minutesBefore: number }
  // V1.1: 人类资料补充完成
  | { type: 'step:human-input-provided'; taskId: string; stepId: string; title: string }
  // 龙虾学院：考试事件
  | { type: 'exam:needs-grading'; enrollmentId: string; submissionId: string; templateId: string; courseName: string; studentName: string; autoGraded?: boolean; passed?: boolean; score?: string }
  | { type: 'exam:graded'; enrollmentId: string; submissionId: string; courseName: string; totalScore: number; maxScore: number; passed: boolean }
  | { type: 'exam:complaint'; submissionId: string; courseName: string; studentName: string; complaintText: string }
  | { type: 'exam:complaint-resolved'; submissionId: string; courseName: string; decision: string; complaintNote: string; adjustedScore?: number }
  // 龙虾学院：Principle 三层下发
  | { type: 'principle:received'; enrollmentId: string; courseName: string; principleTemplate: { coreInsight?: string; keyPrinciples?: string[]; forbiddenList?: string[]; checklist?: string[] }; principleContent?: string; catchup?: boolean }
  // 频道群聊
  | { type: 'channel:message'; channelId: string; messageId: string; senderName: string; content: string; isFromAgent: boolean; agentName?: string }
  | { type: 'channel:mention'; channelId: string; channelName: string; messageId: string; senderName: string; content: string; isFromAgent: boolean; agentName?: string; isInstructorCall?: boolean }
  // P1-1: 打回次数过多，需人工介入
  | { type: 'step:needs-human'; taskId: string; stepId: string; title: string; reason: string }
  // waiting_human: 步骤进入等待人类输入状态
  | { type: 'step:waiting-human'; taskId: string; stepId: string; title: string; message: string }
  // 审批通过
  | { type: 'step:approved'; taskId: string; stepId: string; title: string }
  // 子 Agent 批量创建
  | { type: 'agents:batch-created'; parentAgentId: string; agents: Array<{ id: string; name: string; token: string }> }
  | { type: 'ping' }

// 订阅者类型
interface Subscriber {
  userId: string
  agentId: string
  controller: ReadableStreamDefaultController
  lastPing: number
}

// 内存存储订阅者（生产环境可用 Redis）
const subscribers = new Map<string, Subscriber>()

// 心跳间隔（30秒，保持 SSE 连接活跃，防 Nginx/CDN 超时断连）
const HEARTBEAT_INTERVAL = 30000

/**
 * 添加订阅者
 */
export function addSubscriber(
  userId: string,
  agentId: string,
  controller: ReadableStreamDefaultController
): string {
  const subscriberId = `${userId}-${Date.now()}`

  // ⚡ 踢掉同一 agentId 的旧连接，防止连接泄漏
  // 注意：不要 close() 旧 controller！否则客户端检测到断连会立刻重连，造成踢→重连→踢 死循环
  // 只从 map 里移除，旧连接变僵尸（不再收事件），心跳或 enqueue 失败时自然清理
  const staleIds: string[] = []
  subscribers.forEach((sub, id) => {
    if (sub.agentId === agentId && sub.userId === userId) {
      staleIds.push(id)
    }
  })
  for (const id of staleIds) {
    subscribers.delete(id)
  }
  if (staleIds.length > 0) {
    console.log(`[Events] 移除 ${staleIds.length} 个旧订阅 (agent=${agentId})，不强制断连`)
  }

  subscribers.set(subscriberId, {
    userId,
    agentId,
    controller,
    lastPing: Date.now()
  })

  console.log(`[Events] 订阅者加入: ${subscriberId} (总数: ${subscribers.size})`)

  return subscriberId
}

/**
 * 移除订阅者
 */
export function removeSubscriber(subscriberId: string): boolean {
  const removed = subscribers.delete(subscriberId)
  if (removed) {
    console.log(`[Events] 订阅者离开: ${subscriberId} (剩余: ${subscribers.size})`)
  }
  return removed
}

/** 检查某 userId 是否还有活跃 SSE 连接（用于离线宽限期） */
export function hasUserSubscribers(userId: string): boolean {
  for (const sub of subscribers.values()) {
    if (sub.userId === userId) return true
  }
  return false
}

/**
 * 向指定用户发送事件
 * 对于 chat:incoming / step:ready 等 agent 操作类事件，
 * 每个 agentId 只投递一次（取最新连接），避免多连接重复处理
 *
 * v2.0: 支持 envelopeOpts 用于传递 traceId/correlationId
 */
export function sendToUser(userId: string, event: TeamAgentEvent, envelopeOpts?: EnvelopeOptions) {
  const encoder = new TextEncoder()
  // v2.0: 双栈输出 — envelope(新客户端) + 原始data(老客户端)
  const data = encodeDualStackSSE(event as Record<string, any>, envelopeOpts)

  // step 类事件：每 agentId 只选最新连接（防多 tab 重复领取任务）
  // chat:incoming：广播给所有连接（watch 进程自带去重，浏览器不处理会忽略）
  const stepActionTypes = new Set(['step:ready', 'step:assigned', 'approval:requested'])
  const isStepAction = stepActionTypes.has(event.type)

  const toSend: Map<string, { subId: string; sub: Subscriber }> = new Map()

  subscribers.forEach((sub, id) => {
    if (sub.userId !== userId) return
    if (isStepAction) {
      // 保留每个 agentId 的最新连接（subscriberId 含时间戳，越大越新）
      const existing = toSend.get(sub.agentId)
      if (!existing || id > existing.subId) {
        toSend.set(sub.agentId, { subId: id, sub })
      }
    } else {
      // chat:incoming + 其它事件：发给所有连接
      toSend.set(id, { subId: id, sub })
    }
  })

  let sent = 0
  toSend.forEach(({ subId, sub }) => {
    try {
      sub.controller.enqueue(encoder.encode(data))
      sent++
    } catch (error) {
      console.log(`[Events] 发送失败，移除订阅者: ${subId}`)
      removeSubscriber(subId)
    }
  })

  if (sent > 0) {
    console.log(`[Events] 发送给用户 ${userId}: ${event.type} (${sent} 个连接)`)
  } else {
    // ⚠️ 关键诊断：0 个订阅者意味着 SSE 连接不存在或 userId 不匹配
    console.warn(`[Events] ⚠️ 用户 ${userId} 无订阅者，${event.type} 事件已丢弃（总订阅者: ${subscribers.size}）`)
    if (subscribers.size > 0) {
      const allUserIds = [...new Set([...subscribers.values()].map(s => s.userId))]
      console.warn(`[Events]   当前在线 userIds: ${allUserIds.join(', ')}`)
    }
  }
}

/**
 * 向多个用户发送事件
 */
export function sendToUsers(userIds: string[], event: TeamAgentEvent) {
  userIds.forEach(userId => sendToUser(userId, event))
}

/**
 * 广播事件给所有订阅者
 */
export function broadcast(event: TeamAgentEvent) {
  const encoder = new TextEncoder()
  const data = encodeDualStackSSE(event as Record<string, any>)

  subscribers.forEach((sub, id) => {
    try {
      sub.controller.enqueue(encoder.encode(data))
    } catch (error) {
      removeSubscriber(id)
    }
  })

  console.log(`[Events] 广播: ${event.type} (${subscribers.size} 个订阅者)`)
}

/**
 * 发送心跳（保持连接）
 */
export function sendHeartbeat() {
  broadcast({ type: 'ping' })
}

// 启动心跳定时器
let heartbeatTimer: NodeJS.Timeout | null = null

export function startHeartbeat() {
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)
    console.log('[Events] 心跳已启动')
  }
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    console.log('[Events] 心跳已停止')
  }
}

/**
 * 获取订阅者统计
 */
export function getStats() {
  const userSet = new Set<string>()
  subscribers.forEach(sub => userSet.add(sub.userId))

  return {
    totalConnections: subscribers.size,
    uniqueUsers: userSet.size
  }
}

// ─── 定时任务调度器 ─────────────────────────────────────
// 每 60 秒扫描 nextRunAt <= now 的模板并触发执行

const SCHEDULED_TICK_INTERVAL = 60000  // 60 秒
let scheduledTickTimer: NodeJS.Timeout | null = null
let tickRunning = false  // 防并发

const STEP_TIMEOUT_MS = 30 * 60 * 1000  // 30 分钟无更新视为卡死

async function resetTimedOutSteps() {
  const { prisma } = await import('@/lib/db')
  const cutoff = new Date(Date.now() - STEP_TIMEOUT_MS)
  const stuck = await prisma.taskStep.updateMany({
    where: {
      status: 'in_progress',
      agentStatus: { in: ['working', 'pending'] },
      updatedAt: { lt: cutoff },
    },
    data: { status: 'pending', agentStatus: 'pending' },
  })
  if (stuck.count > 0) {
    console.log(`[ScheduledTick] ⏱️ 重置 ${stuck.count} 个超时卡死步骤 → pending`)
  }
}

async function scheduledTick() {
  if (tickRunning) return
  tickRunning = true
  try {
    // 动态 import 避免循环依赖（events ← scheduled-executor ← step-scheduling ← events）
    const { prisma } = await import('@/lib/db')

    // 超时步骤重置
    await resetTimedOutSteps()

    const now = new Date()
    const dueTemplates = await prisma.taskTemplate.findMany({
      where: { scheduleEnabled: true, nextRunAt: { lte: now } },
      select: { id: true, name: true },
    })
    if (dueTemplates.length === 0) {
      tickRunning = false
      return
    }
    console.log(`[ScheduledTick] 发现 ${dueTemplates.length} 个到期模板`)
    const { executeScheduledTemplate } = await import('./scheduled-executor')
    for (const t of dueTemplates) {
      try {
        const result = await executeScheduledTemplate(t.id)
        if (result.success) {
          console.log(`[ScheduledTick] ✅ "${t.name}" → Task ${result.taskId}`)
        } else {
          console.warn(`[ScheduledTick] ⚠️ "${t.name}" 失败: ${result.error}`)
        }
      } catch (e: any) {
        console.error(`[ScheduledTick] ❌ "${t.name}" 异常:`, e?.message)
      }
    }
  } catch (e) {
    console.error('[ScheduledTick] tick 异常:', e)
  } finally {
    tickRunning = false
  }
}

export function startScheduledTicker() {
  if (!scheduledTickTimer) {
    scheduledTickTimer = setInterval(scheduledTick, SCHEDULED_TICK_INTERVAL)
    console.log('[ScheduledTick] 定时任务调度器已启动（60s 间隔）')
  }
}

export function stopScheduledTicker() {
  if (scheduledTickTimer) {
    clearInterval(scheduledTickTimer)
    scheduledTickTimer = null
    console.log('[ScheduledTick] 定时任务调度器已停止')
  }
}

// ─── 日程提醒调度器 ─────────────────────────────────────
// 每 30 秒扫描 remindAt <= now AND reminded = false 的日程，发送 SSE 提醒

const REMINDER_TICK_INTERVAL = 30000  // 30 秒
let reminderTickTimer: NodeJS.Timeout | null = null
let reminderRunning = false

async function reminderTick() {
  if (reminderRunning) return
  reminderRunning = true
  try {
    const { prisma } = await import('@/lib/db')
    const now = new Date()
    const dueEvents = await prisma.scheduleEvent.findMany({
      where: {
        remindAt: { lte: now },
        reminded: false,
        status: 'active',
      },
      select: { id: true, userId: true, title: true, emoji: true, startAt: true, remindAt: true },
      take: 50,
    })
    if (dueEvents.length === 0) {
      reminderRunning = false
      return
    }
    console.log(`[ReminderTick] 发现 ${dueEvents.length} 条到期提醒`)
    for (const evt of dueEvents) {
      try {
        const minutesBefore = Math.max(0, Math.round((evt.startAt.getTime() - now.getTime()) / 60000))
        sendToUser(evt.userId, {
          type: 'schedule:reminder',
          eventId: evt.id,
          title: evt.title,
          emoji: evt.emoji || '📅',
          startAt: evt.startAt.toISOString(),
          minutesBefore,
        })
        // 标记已提醒
        await prisma.scheduleEvent.update({
          where: { id: evt.id },
          data: { reminded: true },
        })
        console.log(`[ReminderTick] ✅ 提醒 "${evt.title}" → 用户 ${evt.userId}`)
      } catch (e: any) {
        console.error(`[ReminderTick] ❌ "${evt.title}" 异常:`, e?.message)
      }
    }
  } catch (e) {
    console.error('[ReminderTick] tick 异常:', e)
  } finally {
    reminderRunning = false
  }
}

export function startReminderTicker() {
  if (!reminderTickTimer) {
    reminderTickTimer = setInterval(reminderTick, REMINDER_TICK_INTERVAL)
    console.log('[ReminderTick] 日程提醒调度器已启动（30s 间隔）')
  }
}

export function stopReminderTicker() {
  if (reminderTickTimer) {
    clearInterval(reminderTickTimer)
    reminderTickTimer = null
    console.log('[ReminderTick] 日程提醒调度器已停止')
  }
}
