import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
import { createNotification, notificationTemplates } from '@/lib/notifications'

// GET /api/steps/[id]/comments — 获取步骤评论列表
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 双重鉴权：NextAuth session 或 Bearer token
    let userId: string | null = null

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
    } else {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } })
        userId = user?.id || null
      }
    }

    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 验证步骤存在
    const step = await prisma.taskStep.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 查询评论
    const comments = await prisma.stepComment.findMany({
      where: { stepId: id },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatar: true }
        },
        attachments: {
          select: { id: true, name: true, url: true, type: true, size: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    return NextResponse.json({
      comments: comments.map(c => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        author: {
          id: c.author.id,
          name: c.author.name,
          email: c.author.email,
          avatar: c.author.avatar
        },
        attachments: c.attachments
      }))
    })
  } catch (error) {
    console.error('获取评论失败:', error)
    return NextResponse.json({ error: '获取评论失败' }, { status: 500 })
  }
}

// POST /api/steps/[id]/comments — 发表评论
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { content, attachmentIds } = await req.json()

    if (!content?.trim()) {
      return NextResponse.json({ error: '评论内容不能为空' }, { status: 400 })
    }

    // 双重鉴权
    let userId: string | null = null
    let userName: string = '未知用户'

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
      userName = tokenAuth.user.name || tokenAuth.user.email
    } else {
      const session = await getServerSession(authOptions)
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } })
        if (user) {
          userId = user.id
          userName = user.name || user.email
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 验证步骤存在，并获取任务信息
    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: { select: { id: true, creatorId: true, title: true } } }
    })
    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 创建评论
    const comment = await prisma.stepComment.create({
      data: {
        content: content.trim(),
        stepId: id,
        authorId: userId
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatar: true }
        }
      }
    })

    // 关联附件（如果有）
    if (attachmentIds && attachmentIds.length > 0) {
      await prisma.attachment.updateMany({
        where: {
          id: { in: attachmentIds },
          uploaderId: userId // 只能关联自己上传的附件
        },
        data: { commentId: comment.id }
      })
    }

    // 获取完整评论（含附件）
    const fullComment = await prisma.stepComment.findUnique({
      where: { id: comment.id },
      include: {
        author: { select: { id: true, name: true, email: true, avatar: true } },
        attachments: { select: { id: true, name: true, url: true, type: true, size: true } }
      }
    })

    // F02: 解析 @mentions — 格式: @[显示名](userId)
    const mentionRegex = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g
    const mentionedUserIds = new Set<string>()
    let match
    while ((match = mentionRegex.exec(content)) !== null) {
      const mentionedId = match[2]
      if (mentionedId !== userId) { // 不通知自己
        mentionedUserIds.add(mentionedId)
      }
    }

    // 通知相关人员（排除自己）
    const notifyUserIds = new Set<string>()

    // 通知任务创建者
    if (step.task.creatorId && step.task.creatorId !== userId) {
      notifyUserIds.add(step.task.creatorId)
    }

    // 通知步骤负责人
    if (step.assigneeId && step.assigneeId !== userId) {
      notifyUserIds.add(step.assigneeId)
    }

    // 发送 SSE + 站内通知（评论通知）
    for (const targetUserId of notifyUserIds) {
      sendToUser(targetUserId, {
        type: 'step:commented',
        taskId: step.taskId,
        stepId: id,
        commentId: comment.id,
        authorName: userName
      })

      const template = notificationTemplates.stepCommented(step.title, userName)
      await createNotification({
        userId: targetUserId,
        ...template,
        taskId: step.taskId,
        stepId: id
      })
    }

    // F02: 给被 @mention 的人发送专门的提及通知
    for (const mentionedId of mentionedUserIds) {
      if (!notifyUserIds.has(mentionedId)) {
        // 这些人没有收到评论通知，单独发 mention 通知
        sendToUser(mentionedId, {
          type: 'step:mentioned',
          taskId: step.taskId,
          stepId: id,
          commentId: comment.id,
          authorName: userName,
          content: content.trim().substring(0, 100)
        })
      } else {
        // 已经收到评论通知的，额外发一条 mention SSE（让前端高亮）
        sendToUser(mentionedId, {
          type: 'step:mentioned',
          taskId: step.taskId,
          stepId: id,
          commentId: comment.id,
          authorName: userName,
          content: content.trim().substring(0, 100)
        })
      }

      // 创建 mention 站内通知
      const mentionTemplate = notificationTemplates.mentioned(step.title, userName)
      await createNotification({
        userId: mentionedId,
        ...mentionTemplate,
        taskId: step.taskId,
        stepId: id
      })
    }

    return NextResponse.json({
      comment: {
        id: fullComment!.id,
        content: fullComment!.content,
        createdAt: fullComment!.createdAt.toISOString(),
        author: fullComment!.author,
        attachments: fullComment!.attachments
      }
    })
  } catch (error) {
    console.error('发表评论失败:', error)
    return NextResponse.json({ error: '发表评论失败' }, { status: 500 })
  }
}
