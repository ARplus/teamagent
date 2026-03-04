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

    // 查询评论（包含 author 关联的 Agent 信息）
    const comments = await prisma.stepComment.findMany({
      where: { stepId: id },
      include: {
        author: {
          select: {
            id: true, name: true, email: true, avatar: true,
            agent: { select: { id: true, name: true } }
          }
        },
        attachments: {
          select: { id: true, name: true, url: true, type: true, size: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    return NextResponse.json({
      comments: comments.map(c => {
        const agent = (c.author as any).agent
        const fromAgent = (c as any).isFromAgent
        return {
          id: c.id,
          content: c.content,
          isFromAgent: fromAgent || false,
          createdAt: c.createdAt.toISOString(),
          author: {
            id: c.author.id,
            name: fromAgent && agent ? agent.name : c.author.name,
            email: c.author.email,
            avatar: c.author.avatar,
            isAgent: fromAgent || false,
            ...(agent ? { agentName: agent.name } : {})
          },
          attachments: c.attachments
        }
      })
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
    let isFromAgent = false

    const tokenAuth = await authenticateRequest(req)
    if (tokenAuth) {
      userId = tokenAuth.user.id
      isFromAgent = true
      // Agent 通过 token 认证，查找 Agent 名字
      const agent = await prisma.agent.findFirst({
        where: { userId: tokenAuth.user.id },
        select: { name: true }
      })
      userName = agent?.name || tokenAuth.user.name || tokenAuth.user.email
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
        authorId: userId,
        isFromAgent,
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
    const mentionedAgentSelf = new Set<string>() // 人类@自己的Agent（userId相同但实体不同）
    let match
    while ((match = mentionRegex.exec(content)) !== null) {
      const displayName = match[1]
      const mentionedId = match[2]
      if (mentionedId !== userId) {
        // 不同用户：正常通知
        mentionedUserIds.add(mentionedId)
      } else {
        // 同 userId：检查是否在 @自己的 Agent（人类和 Agent 共享 userId）
        // 如果 displayName 是 Agent 名字而非人类名字，仍需通知 agent-worker
        mentionedAgentSelf.add(displayName)
      }
    }

    // 检查"自己@自己的Agent"场景：查 DB 确认是否有同名 Agent
    if (mentionedAgentSelf.size > 0) {
      const myAgent = await prisma.agent.findFirst({
        where: { userId },
        select: { name: true }
      })
      if (myAgent && mentionedAgentSelf.has(myAgent.name)) {
        // 人类在 @自己的 Agent — 放行，agent-worker 需要收到通知
        mentionedUserIds.add(userId)
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
    // 同时通知子Agent的主Agent（子Agent可能没有独立watch进程）
    const mentionEvent = {
      type: 'step:mentioned' as const,
      taskId: step.taskId,
      stepId: id,
      commentId: comment.id,
      authorId: userId,
      authorName: userName,
      content: content.trim().substring(0, 100)
    }

    for (const mentionedId of mentionedUserIds) {
      sendToUser(mentionedId, mentionEvent)

      // 如果被@的是子Agent，也通知其主Agent（子Agent可能不在线）
      try {
        const mentionedAgent = await prisma.agent.findFirst({
          where: { userId: mentionedId },
          select: { parentAgentId: true }
        })
        if (mentionedAgent?.parentAgentId) {
          const parentAgent = await prisma.agent.findFirst({
            where: { id: mentionedAgent.parentAgentId },
            select: { userId: true }
          })
          if (parentAgent?.userId && parentAgent.userId !== userId) {
            sendToUser(parentAgent.userId, mentionEvent)
          }
        }
      } catch { /* 查询失败不影响主流程 */ }

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
