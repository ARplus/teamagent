import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

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

// POST /api/tasks/[id]/steps - 添加步骤
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    // 验证任务存在
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: true }
    })

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    const { title, description, assigneeId, assigneeEmail,
            stepType, agenda, participants, scheduledAt,
            requiresApproval, insertAfterOrder, parallelGroup } = await req.json()

    if (!title) {
      return NextResponse.json({ error: '步骤标题不能为空' }, { status: 400 })
    }

    // 解析负责人
    let finalAssigneeId = assigneeId
    if (!finalAssigneeId && assigneeEmail) {
      const assignee = await prisma.user.findUnique({
        where: { email: assigneeEmail }
      })
      if (assignee) {
        finalAssigneeId = assignee.id
      }
    }

    // 计算步骤顺序
    let newOrder: number
    if (insertAfterOrder != null) {
      // 插入中间：把 order > insertAfterOrder 的步骤都往后挪一位
      await prisma.taskStep.updateMany({
        where: { taskId, order: { gt: insertAfterOrder } },
        data: { order: { increment: 1 } }
      })
      newOrder = insertAfterOrder + 1
    } else {
      // 追加末尾
      const maxOrder = task.steps.reduce((max, s) => Math.max(max, s.order), 0)
      newOrder = maxOrder + 1
    }

    const step = await prisma.taskStep.create({
      data: {
        title,
        description,
        order: newOrder,
        taskId,
        assigneeId: finalAssigneeId,
        stepType: stepType || 'task',
        agenda: agenda || null,
        participants: participants ? JSON.stringify(participants) : null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        requiresApproval: requiresApproval !== false, // 默认 true，false 时自动通过
        parallelGroup: parallelGroup || null,
      },
      include: {
        assignee: { select: { id: true, name: true, avatar: true } },
        attachments: true
      }
    })

    return NextResponse.json(step)

  } catch (error) {
    console.error('添加步骤失败:', error)
    return NextResponse.json({ error: '添加步骤失败' }, { status: 500 })
  }
}
