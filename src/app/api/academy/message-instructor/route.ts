// POST /api/academy/message-instructor
// 学员呼叫讲师 → 创建/复用 DM 频道 → 发消息 → 通知讲师 Agent
// 支持 Session Auth（浏览器）+ Token Auth（Agent CLI）
// { courseId: string, message: string }
// Returns: { ok: true, channelId, workspaceId } — 前端跳转到频道

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser, type TeamAgentEvent } from '@/lib/events'

export async function POST(req: NextRequest) {
  // 双认证：Token 优先，Session 兜底
  let userId: string | null = null
  let isFromAgent = false

  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    userId = tokenAuth.user.id
    isFromAgent = !!(tokenAuth.user as any).agent
  }
  if (!userId) {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      userId = user?.id || null
    }
  }
  if (!userId) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const { courseId, message } = await req.json()
  if (!message?.trim()) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 })
  }

  // 找当前学员
  const learner = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, agent: { select: { id: true, name: true } } },
  })
  if (!learner) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  // 找课程和讲师
  const course = await prisma.taskTemplate.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      name: true,
      creatorId: true,
      creator: { select: { id: true, name: true } },
      workspaceId: true,
    },
  })
  if (!course || !course.creatorId) {
    return NextResponse.json({ error: '课程不存在' }, { status: 404 })
  }

  // 讲师的 Agent
  const instructorAgent = await prisma.agent.findFirst({
    where: { userId: course.creatorId },
    select: { id: true, name: true },
  })

  // DM 频道 slug: dm-{learnerId}-{courseId 前8位} 保证唯一
  const dmSlug = `dm-${learner.id.slice(-8)}-${courseId.slice(-8)}`
  const workspaceId = course.workspaceId

  if (!workspaceId) {
    return NextResponse.json({ error: '课程没有关联工作区' }, { status: 400 })
  }

  // 找或创建 DM 频道
  let channel = await prisma.channel.findUnique({
    where: { workspaceId_slug: { workspaceId, slug: dmSlug } },
  })

  // Agent 呼叫时用 Agent 名，人类呼叫时用人类名
  const learnerName = isFromAgent
    ? (learner.agent?.name || learner.name || '学员Agent')
    : (learner.name || learner.agent?.name || '学员')
  const instructorName = instructorAgent?.name || course.creator?.name || '讲师'

  if (!channel) {
    channel = await prisma.channel.create({
      data: {
        workspaceId,
        name: `${learnerName} ↔ ${instructorName}`,
        slug: dmSlug,
        description: `课程「${course.name}」答疑频道`,
      },
    })

    // 确保学员也是工作区成员（否则看不到频道）
    const isMember = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: learner.id, workspaceId } },
    })
    if (!isMember) {
      await prisma.workspaceMember.create({
        data: { userId: learner.id, workspaceId, role: 'member' },
      })
    }
  }

  // 发消息到频道
  const fullContent = `@${instructorName} 【课程答疑 · 《${course.name}》】\n\n${message.trim()}`
  const msg = await prisma.channelMessage.create({
    data: {
      content: fullContent,
      channelId: channel.id,
      senderId: learner.id,
      isFromAgent,
    },
  })

  // SSE 通知讲师 Agent：channel:mention（触发 Watch 自动回复）
  // isInstructorCall=true 告诉客户端：这是"呼叫讲师"场景，即使 isFromAgent 也必须回复（不触发死循环防护）
  if (course.creatorId) {
    const mentionEvent: TeamAgentEvent = {
      type: 'channel:mention',
      channelId: channel.id,
      channelName: channel.name,
      messageId: msg.id,
      senderName: learnerName,
      content: fullContent,
      isFromAgent,
      isInstructorCall: true,
    }
    sendToUser(course.creatorId, mentionEvent)
    console.log(`[MessageInstructor] ${learnerName}${isFromAgent ? '(Agent)' : ''} → ${instructorName} in #${channel.name} [instructorCall]`)
  }

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
    workspaceId,
  })
}
