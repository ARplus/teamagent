import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { addSubscriber, removeSubscriber, startHeartbeat, startReminderTicker, sendToUsers, hasUserSubscribers } from '@/lib/events'

// SSE 长连接需要：强制动态 + 无超时
export const dynamic = 'force-dynamic'
export const maxDuration = 3600 // 1小时（靠心跳保活，避免5分钟强制断连）

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    // API token 认证 = OpenClaw / 真实 Agent 客户端
    return { userId: tokenAuth.user.id, user: tokenAuth.user, isBrowser: false }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      // Session cookie 认证 = 浏览器 EventToast 连接
      return { userId: user.id, user, isBrowser: true }
    }
  }

  return null
}

/**
 * GET /api/agent/subscribe
 * 
 * SSE 端点，Agent 订阅实时事件
 * 
 * 使用方式（客户端）:
 * ```javascript
 * const eventSource = new EventSource('/api/agent/subscribe', {
 *   headers: { 'Authorization': 'Bearer ta_xxx' }
 * })
 * 
 * eventSource.onmessage = (event) => {
 *   const data = JSON.parse(event.data)
 *   console.log('收到事件:', data)
 * }
 * ```
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)

  if (!auth) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { isBrowser } = auth

  // 获取用户的 Agent（可能没有，Agent-First 模式下用户先注册后认领）
  const agent = await prisma.agent.findUnique({
    where: { userId: auth.userId }
  })

  // 没有 Agent 也允许连接，返回等待状态
  if (!agent) {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const msg = `data: ${JSON.stringify({
          type: 'connected',
          agentId: null,
          agentName: null,
          message: '🔗 已连接，等待认领 Agent'
        })}\n\n`
        controller.enqueue(encoder.encode(msg))
        // 保持连接但不订阅事件
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }

  // 只有 OpenClaw 真实客户端才更新 Agent 状态为在线
  // 若 Agent 被暂停（paused），不自动恢复为 online，保持 paused 状态
  const wasOffline = agent.status === 'offline' || agent.status === 'error'
  if (!isBrowser && agent.status !== 'paused') {
    await prisma.agent.update({
      where: { id: agent.id },
      data: { status: 'online', lastHeartbeatAt: new Date() }
    })
  }

  // Agent 上线广播：向工作区所有成员推送 agent:online 事件
  // ⚠️ 炸点C修复：不再限制 wasOffline——任何非浏览器 SSE 连接（含重连）都广播
  // 原因：心跳可能保住了 DB 没有变 offline（wasOffline=false），但前端仍显示残留的 offline 状态
  if (!isBrowser) {
    // 异步广播，不阻塞 SSE 连接
    ;(async () => {
      try {
        // 找到 Agent 所属的工作区成员
        const memberships = await prisma.workspaceMember.findMany({
          where: { userId: auth.userId },
          select: { workspaceId: true },
        })
        if (memberships.length > 0) {
          const wsId = memberships[0].workspaceId
          const allMembers = await prisma.workspaceMember.findMany({
            where: { workspaceId: wsId },
            select: { userId: true },
          })
          const otherUserIds = allMembers
            .map(m => m.userId)
            .filter(id => id !== auth.userId)

          if (otherUserIds.length > 0) {
            sendToUsers(otherUserIds, {
              type: 'agent:online' as any,
              agentId: agent.id,
              agentName: agent.name,
              userId: auth.userId,
            })
          }
        }
        console.log(`[Subscribe] 📢 ${agent.name} 上线广播`)
      } catch (e: any) {
        console.error(`[Subscribe] 上线广播失败:`, e.message)
      }
    })()
  }

  // 确保心跳已启动
  startHeartbeat()
  // 日程提醒调度器
  startReminderTicker()
  // ⚠️ 定时任务调度器已禁用（功能回退）
  // startScheduledTicker()

  // 断点续传：读取 Last-Event-ID 或 since 参数
  const lastEventId = req.headers.get('last-event-id') || req.nextUrl.searchParams.get('since')
  const sinceDate = lastEventId ? new Date(lastEventId) : null

  // 预查断连期间漏掉的 chat:incoming：找还是 __pending__ 的 agent 消息
  // 并关联上前一条 user 消息内容
  // 限制：只补发 15 分钟内的（超时说明 Agent 无法处理，不再重推）
  // 同时跳过 source=system 的系统通知（如子Agent创建通知，Agent 会主动处理，无需重推）
  interface MissedMsg { agentMsgId: string; content: string; createdAt: Date }
  let missedMessages: MissedMsg[] = []
  if (sinceDate && !isNaN(sinceDate.getTime())) {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000)
    const pendingAgentMsgs = await prisma.chatMessage.findMany({
      where: {
        userId: auth.userId,
        role: 'agent',
        content: '__pending__',
        createdAt: { gt: sinceDate > fifteenMinsAgo ? sinceDate : fifteenMinsAgo }
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true, createdAt: true }
    })
    for (const pm of pendingAgentMsgs) {
      // 找同一毫秒前后的 user 消息
      const userMsg = await prisma.chatMessage.findFirst({
        where: { userId: auth.userId, role: 'user', createdAt: { lte: pm.createdAt } },
        orderBy: { createdAt: 'desc' },
        select: { content: true, metadata: true }
      })
      // 跳过系统消息（子Agent创建通知等），避免反复重推
      if (userMsg?.metadata) {
        try {
          const meta = JSON.parse(userMsg.metadata)
          if (meta.source === 'system') continue
        } catch { /* ignore */ }
      }
      missedMessages.push({ agentMsgId: pm.id, content: userMsg?.content || '', createdAt: pm.createdAt })
    }
  }
  // 无 since 时不主动补发历史消息，避免每次连接都轰炸

  // 创建 SSE 流
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // 辅助函数：发带 id: 字段的 SSE 事件
      function sendEvent(payload: object) {
        const id = Date.now().toString()
        const line = `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`
        try { controller.enqueue(encoder.encode(line)) } catch { /* 连接已关闭 */ }
      }

      // 每 30s 发一个 ": ping" 注释行，防止 NAT/代理超时断连
      const pingTimer = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)) } catch { clearInterval(pingTimer) }
      }, 30000)

      // 发送连接成功消息
      const welcomeMsg = `data: ${JSON.stringify({
        type: 'connected',
        agentId: agent.id,
        agentName: agent.name,
        message: '🦞 已连接到 TeamAgent'
      })}\n\n`
      controller.enqueue(encoder.encode(welcomeMsg))

      // 补发断连期间漏掉的消息（chat:incoming，agentMsgId 就是占位消息 id）
      for (const m of missedMessages) {
        const catchupMsg = `data: ${JSON.stringify({
          type: 'chat:incoming',
          msgId: m.agentMsgId,
          content: m.content,
          senderName: '用户',
          catchup: true
        })}\n\n`
        controller.enqueue(encoder.encode(catchupMsg))
      }

      // 注册订阅者
      // 浏览器连接用 ${agent.id}-browser 作为 agentId，避免踢掉 OpenClaw 真实连接
      const subscriberAgentId = isBrowser ? `${agent.id}-browser` : agent.id
      const subscriberId = addSubscriber(auth.userId, subscriberAgentId, controller)

      // 🆕 重连补发：只对 OpenClaw 真实连接补发步骤（浏览器跳过；paused 时跳过防止洪泛）
      if (!isBrowser && agent.status !== 'paused') prisma.taskStep.findMany({
        where: {
          assigneeId: auth.userId,
          status: { in: ['in_progress', 'pending'] },
          // 只补发已被 activateAndNotifySteps 激活的步骤（agentStatus='pending'）
          // 未激活的步骤（agentStatus=null）不推，防止并发执行 bug
          agentStatus: 'pending',
        },
        select: { id: true, title: true, taskId: true, stepType: true },
        take: 3,
        orderBy: { createdAt: 'asc' }
      }).then(async pendingSteps => {
        if (pendingSteps.length === 0) return
        console.log(`[Subscribe] 重连补发 ${pendingSteps.length} 个待执行步骤 → ${agent.name}`)
        for (const step of pendingSteps) {
          try {
            if (step.stepType === 'decompose') {
              // 拆解步骤：发 task:decompose-request，避免走 executeDecompose 双重执行
              const task = await prisma.task.findUnique({
                where: { id: step.taskId },
                select: { id: true, title: true, description: true, decomposeStatus: true }
              })
              if (!task) continue
              // 只重推 pending 状态的拆解任务（done/fallback 的不重推，避免洪泛旧任务）
              // pending 和 processing 都重推（processing = ACK后Watch崩溃，需要重试）
              if (task.decomposeStatus !== 'pending' && task.decomposeStatus !== 'processing') continue
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'task:decompose-request',
                taskId: task.id,
                taskTitle: task.title,
                taskDescription: task.description || '',
                catchup: true,
              })}\n\n`))
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'step:ready',
                taskId: step.taskId,
                stepId: step.id,
                title: step.title,
                assigneeType: 'agent',
                catchup: true,
                ...(step.stepType ? { stepType: step.stepType } : {}),
              })}\n\n`))
            }
          } catch { /* 连接可能已关闭 */ }
        }
      }).catch(() => {})

      // 补发：最近 2 小时内已 graduated 但可能 SSE 错过的 principle
      prisma.courseEnrollment.findMany({
        where: {
          userId: auth.userId,
          status: 'graduated',
          principleDelivered: true,
          principleDeliveredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        include: { template: { select: { name: true, principleTemplate: true } } },
        orderBy: { principleDeliveredAt: 'asc' },
        take: 5,
      }).then(enrollments => {
        for (const enrollment of enrollments) {
          if (!enrollment.template?.principleTemplate) continue
          let principleData: any = null
          try {
            const parsed = JSON.parse(enrollment.template.principleTemplate)
            if (parsed.coreInsight || parsed.keyPrinciples || parsed.checklist) principleData = parsed
          } catch { continue }
          if (!principleData) continue
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'principle:received',
              enrollmentId: enrollment.id,
              courseName: enrollment.template.name,
              principleTemplate: principleData,
              principleContent: JSON.stringify(principleData, null, 2),
              catchup: true,
            })}\n\n`))
            console.log(`[Subscribe] 补发 principle:received → 课程「${enrollment.template.name}」userId=${auth.userId}`)
          } catch { /* 连接可能已关闭 */ }
        }
      }).catch(() => {})

      // 当连接关闭时清理
      req.signal.addEventListener('abort', () => {
        clearInterval(pingTimer)
        const wasActive = removeSubscriber(subscriberId)

        // 只有 OpenClaw 真实连接断开时才更新状态为离线
        // 竞态保护：若新连接已建立（addSubscriber 已替换旧 subscriberId），
        // removeSubscriber 返回 false，不覆盖新连接设置的 online 状态
        // 宽限期：spawn() 跑 LLM 期间可能短暂重连，等 12s 确认真的断了再标离线
        if (!isBrowser && wasActive) {
          const offlineUserId = auth.userId
          const offlineAgentId = agent.id
          const offlineAgentName = agent.name
          setTimeout(async () => {
            // 12s 后再检查：如果已有新连接则不标离线
            if (hasUserSubscribers(offlineUserId)) {
              console.log(`[Subscribe] ${offlineAgentName} 已重连，跳过离线标记`)
              return
            }
            // 额外检查：30s 内有 HTTP 心跳也跳过（spawn 期间 SSE 断开但仍在工作）
            const freshAgent = await prisma.agent.findUnique({
              where: { id: offlineAgentId },
              select: { lastHeartbeatAt: true }
            }).catch(() => null)
            if (freshAgent?.lastHeartbeatAt) {
              const secsSinceHeartbeat = (Date.now() - new Date(freshAgent.lastHeartbeatAt).getTime()) / 1000
              // 阈值 60s：心跳 15s 间隔 + 12s 宽限 + 33s 余量（防服务器忙/网络抖动）
              if (secsSinceHeartbeat < 60) {
                console.log(`[Subscribe] ${offlineAgentName} 最近 ${secsSinceHeartbeat.toFixed(0)}s 内有 HTTP 心跳，跳过离线标记`)
                return
              }
            }
            prisma.agent.update({
              where: { id: offlineAgentId },
              data: { status: 'offline' }
            }).then(() => {
              // 离线广播
              prisma.workspaceMember.findMany({
                where: { userId: offlineUserId },
                select: { workspaceId: true },
              }).then(memberships => {
                if (memberships.length === 0) return
                prisma.workspaceMember.findMany({
                  where: { workspaceId: memberships[0].workspaceId },
                  select: { userId: true },
                }).then(members => {
                  const others = members.map(m => m.userId).filter(id => id !== offlineUserId)
                  if (others.length > 0) {
                    sendToUsers(others, {
                      type: 'agent:offline',
                      agentId: offlineAgentId,
                      agentName: offlineAgentName,
                      userId: offlineUserId,
                    })
                  }
                  console.log(`[Subscribe] 📢 ${offlineAgentName} 离线广播（宽限期后确认）`)
                })
              })
            }).catch(console.error)
          }, 12000)
        }
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // 禁用 nginx 缓冲
    }
  })
}
