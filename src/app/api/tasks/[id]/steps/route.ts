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

    const { title, description, assigneeId, assigneeEmail, assigneeType: hintAssigneeType,
            stepType, agenda, participants, scheduledAt,
            requiresApproval, insertAfterOrder, parallelGroup,
            // V1.1: 步骤展开
            parentStepId,
            // V1.1: 人类资料补充
            needsHumanInput, humanInputPrompt,
            } = await req.json()

    if (!title) {
      return NextResponse.json({ error: '步骤标题不能为空' }, { status: 400 })
    }

    // P2: 子步骤只允许一层嵌套
    if (parentStepId) {
      const parentStep = await prisma.taskStep.findUnique({
        where: { id: parentStepId },
        select: { id: true, parentStepId: true, taskId: true }
      })
      if (!parentStep) {
        return NextResponse.json({ error: '父步骤不存在' }, { status: 404 })
      }
      if (parentStep.taskId !== taskId) {
        return NextResponse.json({ error: '父步骤不属于该任务' }, { status: 400 })
      }
      if (parentStep.parentStepId) {
        return NextResponse.json({ error: '只允许一层嵌套，不能给子步骤再创建子步骤' }, { status: 400 })
      }
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
        requiresApproval: requiresApproval !== false,
        parallelGroup: parallelGroup || null,
        // V1.1
        parentStepId: parentStepId || null,
        needsHumanInput: needsHumanInput === true,
        humanInputPrompt: humanInputPrompt || null,
        humanInputStatus: needsHumanInput ? 'waiting' : 'not_needed',
        unassigned: !finalAssigneeId,
        unassignedReason: !finalAssigneeId ? '待分配' : null,
      },
      include: {
        assignee: { select: { id: true, name: true, avatar: true, agent: { select: { id: true, name: true } } } },
        attachments: true
      }
    })

    // 同步创建 StepAssignee 记录（优先用前端传来的 assigneeType，否则自动检测）
    if (finalAssigneeId) {
      let assigneeType: 'agent' | 'human' = hintAssigneeType || 'agent'
      if (!hintAssigneeType) {
        const assigneeAgent = await prisma.agent.findUnique({
          where: { userId: finalAssigneeId },
          select: { id: true }
        })
        if (!assigneeAgent) assigneeType = 'human'
      }
      await prisma.stepAssignee.create({
        data: { stepId: step.id, userId: finalAssigneeId, isPrimary: true, assigneeType }
      }).catch(() => {}) // 忽略唯一约束冲突
    }

    return NextResponse.json(step)

  } catch (error) {
    console.error('添加步骤失败:', error)
    return NextResponse.json({ error: '添加步骤失败' }, { status: 500 })
  }
}
