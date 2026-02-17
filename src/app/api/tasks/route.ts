import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

// 统一认证
async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    return { userId: tokenAuth.user.id, user: tokenAuth.user }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (user) {
      return { userId: user.id, user }
    }
  }

  return null
}

// 获取任务列表
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    const tasks = await prisma.task.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        workspace: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(tasks)

  } catch (error) {
    console.error('获取任务失败:', error)
    return NextResponse.json({ error: '获取任务失败' }, { status: 500 })
  }
}

// 创建任务
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
    }

    const { 
      title, 
      description, 
      status, 
      priority, 
      dueDate, 
      assigneeId,
      assigneeEmail,  // 支持通过邮箱分配
      workspaceId 
    } = await req.json()

    if (!title || !workspaceId) {
      return NextResponse.json(
        { error: '标题和工作区不能为空' },
        { status: 400 }
      )
    }

    // 解析执行者
    let finalAssigneeId = assigneeId
    if (!finalAssigneeId && assigneeEmail) {
      const assignee = await prisma.user.findUnique({
        where: { email: assigneeEmail }
      })
      if (assignee) {
        finalAssigneeId = assignee.id
      }
      // 如果用户不存在，暂时不分配（可以后续发邀请）
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || 'todo',
        priority: priority || 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
        creatorId: auth.userId,
        assigneeId: finalAssigneeId,
        workspaceId
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        workspace: { select: { id: true, name: true } }
      }
    })

    // 🔔 发送实时通知
    // 通知创建者（如果在线）
    sendToUser(auth.userId, {
      type: 'task:created',
      taskId: task.id,
      title: task.title
    })

    // 通知被分配者（如果有）
    if (finalAssigneeId && finalAssigneeId !== auth.userId) {
      sendToUser(finalAssigneeId, {
        type: 'task:created',
        taskId: task.id,
        title: task.title
      })
    }

    return NextResponse.json(task)

  } catch (error) {
    console.error('创建任务失败:', error)
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 })
  }
}
