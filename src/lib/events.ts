/**
 * TeamAgent 事件系统
 * 使用 Server-Sent Events (SSE) 实现实时通知
 */

// 事件类型定义
export type TeamAgentEvent = 
  | { type: 'task:created'; taskId: string; title: string }
  | { type: 'task:updated'; taskId: string; title: string }
  | { type: 'step:ready'; taskId: string; stepId: string; title: string; stepType?: string; taskDescription?: string }
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
export function removeSubscriber(subscriberId: string) {
  const removed = subscribers.delete(subscriberId)
  if (removed) {
    console.log(`[Events] 订阅者离开: ${subscriberId} (剩余: ${subscribers.size})`)
  }
}

/**
 * 向指定用户发送事件
 * 对于 chat:incoming / step:ready 等 agent 操作类事件，
 * 每个 agentId 只投递一次（取最新连接），避免多连接重复处理
 */
export function sendToUser(userId: string, event: TeamAgentEvent) {
  const encoder = new TextEncoder()
  const data = `data: ${JSON.stringify(event)}\n\n`

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
  const data = `data: ${JSON.stringify(event)}\n\n`
  
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
