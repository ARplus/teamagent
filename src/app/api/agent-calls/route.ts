import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, type TeamAgentEvent } from '@/lib/events'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id }
  }
  return null
}

// 检查 DND 状态
async function isUserInDND(userId: string): Promise<boolean> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } })
  if (!pref?.dndEnabled || !pref.dndStart || !pref.dndEnd) return false

  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = pref.dndStart.split(':').map(Number)
  const [endH, endM] = pref.dndEnd.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  // 跨午夜：如 22:00 ~ 08:00
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
  // 同日：如 13:00 ~ 14:00
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

// POST /api/agent-calls — Agent 向主人发起呼叫
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const body = await req.json()
    const { targetUserId, priority, title, content, taskId, stepId } = body as {
      targetUserId: string
      priority?: 'urgent' | 'normal' | 'low'
      title: string
      content?: string
      taskId?: string
      stepId?: string
    }

    if (!targetUserId || !title) {
      return NextResponse.json({ error: '缺少 targetUserId 或 title' }, { status: 400 })
    }

    const callPriority = priority || 'normal'

    // 验证目标用户存在
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!targetUser) return NextResponse.json({ error: '目标用户不存在' }, { status: 404 })

    // 检查调用者身份：是否是 Agent 的 userId，或者是某个 Agent
    const callerAgent = await prisma.agent.findFirst({
      where: { userId: auth.userId },
      select: { id: true, name: true }
    })

    // 检查 DND
    const inDND = await isUserInDND(targetUserId)

    // 检查用户最低通知级别
    const pref = await prisma.userPreference.findUnique({ where: { userId: targetUserId } })
    const minPriority = pref?.minPriority || 'low'
    const priorityOrder = { urgent: 3, normal: 2, low: 1 }
    const shouldPush = priorityOrder[callPriority] >= priorityOrder[minPriority as keyof typeof priorityOrder]

    // 创建通知记录
    const notification = await prisma.notification.create({
      data: {
        type: 'agent_call',
        title,
        content,
        priority: callPriority,
        callStatus: 'pending',
        userId: targetUserId,
        taskId: taskId || null,
        stepId: stepId || null,
      },
    })

    // DND 时紧急通知仍然推送，普通/低优不推送
    const shouldSendSSE = shouldPush && (!inDND || callPriority === 'urgent')

    if (shouldSendSSE) {
      sendToUser(targetUserId, {
        type: 'agent:calling',
        callId: notification.id,
        priority: callPriority,
        title,
        content: content || '',
        agentName: callerAgent?.name || '未知 Agent',
        taskId: taskId || undefined,
        stepId: stepId || undefined,
      } as TeamAgentEvent)
    }

    return NextResponse.json({
      success: true,
      call: {
        id: notification.id,
        priority: callPriority,
        callStatus: 'pending',
        delivered: shouldSendSSE,
        inDND,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('创建 Agent 呼叫失败:', error)
    return NextResponse.json({ error: '创建呼叫失败' }, { status: 500 })
  }
}

// GET /api/agent-calls — 获取待处理的呼叫列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const calls = await prisma.notification.findMany({
      where: {
        userId: auth.userId,
        type: 'agent_call',
        callStatus: 'pending',
      },
      include: {
        task: { select: { id: true, title: true } },
        step: { select: { id: true, title: true } },
      },
      orderBy: [
        // 紧急优先
        { priority: 'asc' }, // urgent < normal < low 字母排序刚好反过来，需要手动
        { createdAt: 'desc' },
      ],
    })

    // 按优先级排序：urgent → normal → low
    const priorityWeight = { urgent: 0, normal: 1, low: 2 }
    const sortedCalls = calls.sort(
      (a, b) =>
        (priorityWeight[a.priority as keyof typeof priorityWeight] || 1) -
        (priorityWeight[b.priority as keyof typeof priorityWeight] || 1)
    )

    return NextResponse.json({
      calls: sortedCalls.map(c => ({
        id: c.id,
        title: c.title,
        content: c.content,
        priority: c.priority,
        callStatus: c.callStatus,
        createdAt: c.createdAt.toISOString(),
        task: c.task,
        step: c.step,
      })),
      count: sortedCalls.length,
    })
  } catch (error) {
    console.error('获取 Agent 呼叫列表失败:', error)
    return NextResponse.json({ error: '获取呼叫列表失败' }, { status: 500 })
  }
}
