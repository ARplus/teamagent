import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

async function getUserId(req: NextRequest): Promise<string | null> {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return tokenAuth.user.id
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    return user?.id || null
  }
  return null
}

/**
 * GET /api/academy/courses/[id]/comments — 获取课程评论
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: templateId } = await params

    // 验证课程存在 + 用户有权限（已报名 或 创建者）
    const course = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, creatorId: true, courseType: true },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    const isCreator = course.creatorId === userId
    if (!isCreator) {
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_templateId: { userId, templateId } },
      })
      if (!enrollment) return NextResponse.json({ error: '需要报名才能查看评论' }, { status: 403 })
    }

    const comments = await prisma.courseComment.findMany({
      where: { templateId },
      include: {
        author: {
          select: {
            id: true, name: true, avatar: true,
            agent: { select: { id: true, name: true } },
          }
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // 同时返回可 @ 的人员列表（已报名学员 + 创建者）
    const enrolledUsers = await prisma.courseEnrollment.findMany({
      where: { templateId },
      select: {
        user: { select: { id: true, name: true, avatar: true } },
      },
    })
    const creator = await prisma.user.findUnique({
      where: { id: course.creatorId },
      select: { id: true, name: true, avatar: true },
    })

    const mentionableUsers = [
      ...(creator ? [creator] : []),
      ...enrolledUsers.map(e => e.user).filter(u => u.id !== course.creatorId),
    ]

    return NextResponse.json({ comments, mentionableUsers })
  } catch (error) {
    console.error('[Academy/Comments/GET] 失败:', error)
    return NextResponse.json({ error: '获取评论失败' }, { status: 500 })
  }
}

/**
 * POST /api/academy/courses/[id]/comments — 发表评论
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id: templateId } = await params
    const body = await req.json()
    const { content } = body
    if (!content?.trim()) return NextResponse.json({ error: '评论不能为空' }, { status: 400 })

    // 验证权限
    const course = await prisma.taskTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, creatorId: true, courseType: true },
    })
    if (!course || !course.courseType) {
      return NextResponse.json({ error: '课程不存在' }, { status: 404 })
    }

    const isCreator = course.creatorId === userId
    if (!isCreator) {
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_templateId: { userId, templateId } },
      })
      if (!enrollment) return NextResponse.json({ error: '需要报名才能评论' }, { status: 403 })
    }

    // 创建评论
    const comment = await prisma.courseComment.create({
      data: { content: content.trim(), templateId, authorId: userId },
      include: {
        author: {
          select: {
            id: true, name: true, avatar: true,
            agent: { select: { id: true, name: true } },
          }
        },
      },
    })

    const userName = comment.author.name || '学员'

    // 解析 @mentions — 格式: @[显示名](userId)
    const mentionRegex = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g
    const mentionedUserIds = new Set<string>()
    let match
    while ((match = mentionRegex.exec(content)) !== null) {
      const mentionedId = match[2]
      if (mentionedId !== userId) {
        mentionedUserIds.add(mentionedId)
      }
    }

    // 通知课程创建者（如果不是自己发的、且不在@列表中）
    if (course.creatorId !== userId && !mentionedUserIds.has(course.creatorId)) {
      sendToUser(course.creatorId, {
        type: 'course:comment' as any,
        templateId,
        commentId: comment.id,
        authorName: userName,
        content: content.trim().substring(0, 100),
      })
      const template = notificationTemplates.courseCommented(course.name, userName)
      await createNotification({ userId: course.creatorId, ...template })
    }

    // 给 @mention 的人发通知
    for (const mentionedId of mentionedUserIds) {
      sendToUser(mentionedId, {
        type: 'course:comment' as any,
        templateId,
        commentId: comment.id,
        authorName: userName,
        content: content.trim().substring(0, 100),
      })
      const template = notificationTemplates.courseMentioned(course.name, userName)
      await createNotification({ userId: mentionedId, ...template })
    }

    return NextResponse.json({ comment })
  } catch (error) {
    console.error('[Academy/Comments/POST] 失败:', error)
    return NextResponse.json({ error: '评论失败' }, { status: 500 })
  }
}
