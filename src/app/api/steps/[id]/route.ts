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

// GET /api/steps/[id] - 获取步骤详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: {
        task: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } }
          }
        },
        attachments: true
      }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    return NextResponse.json(step)

  } catch (error) {
    console.error('获取步骤失败:', error)
    return NextResponse.json({ error: '获取步骤失败' }, { status: 500 })
  }
}

// PATCH /api/steps/[id] - 更新步骤
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 只有任务创建者或步骤负责人可以更新
    if (step.task.creatorId !== auth.userId && step.assigneeId !== auth.userId) {
      return NextResponse.json({ error: '无权限更新此步骤' }, { status: 403 })
    }

    const data = await req.json()

    // 允许更新的字段
    const updateData: any = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.description !== undefined) updateData.description = data.description
    if (data.status !== undefined) updateData.status = data.status
    if (data.agentStatus !== undefined) updateData.agentStatus = data.agentStatus
    if (data.result !== undefined) updateData.result = data.result
    if (data.order !== undefined) updateData.order = data.order
    if (data.parallelGroup !== undefined) updateData.parallelGroup = data.parallelGroup || null
    // B08: 多人指派路径
    if (data.assigneeIds && Array.isArray(data.assigneeIds) && data.assigneeIds.length > 0) {
      // 验证所有 assignee 是工作区成员
      for (const a of data.assigneeIds) {
        const isMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: step.task.workspaceId, userId: a.userId }
        })
        if (!isMember) {
          return NextResponse.json({ error: `用户 ${a.userId} 不在工作区中` }, { status: 403 })
        }
      }

      // 获取所有被指派者的显示名
      const userIds = data.assigneeIds.map((a: any) => a.userId)
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, agent: { select: { name: true } } }
      })
      const nameMap = new Map(users.map(u => [u.id, u.agent?.name || u.name || u.email]))

      // 事务：删旧 → 创建新 → 更新步骤
      await prisma.$transaction(async (tx) => {
        await tx.stepAssignee.deleteMany({ where: { stepId: id } })
        await tx.stepAssignee.createMany({
          data: data.assigneeIds.map((a: any, i: number) => ({
            stepId: id,
            userId: a.userId,
            assigneeType: a.assigneeType || 'agent',
            isPrimary: i === 0,
          }))
        })
        const names = data.assigneeIds.map((a: any) => nameMap.get(a.userId) || '未知')
        await tx.taskStep.update({
          where: { id },
          data: {
            assigneeId: data.assigneeIds[0].userId,
            assigneeNames: JSON.stringify(names),
            completionMode: data.completionMode || 'all',
          }
        })
      })
    }
    // B08: 清空所有指派
    else if (data.assigneeIds && Array.isArray(data.assigneeIds) && data.assigneeIds.length === 0) {
      await prisma.$transaction(async (tx) => {
        await tx.stepAssignee.deleteMany({ where: { stepId: id } })
        await tx.taskStep.update({
          where: { id },
          data: { assigneeId: null, assigneeNames: null }
        })
      })
    }
    // 旧路径：单人分配（向后兼容）
    else if (data.assigneeId !== undefined) {
      const newAssigneeId = data.assigneeId || null
      if (newAssigneeId) {
        const isMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: step.task.workspaceId, userId: newAssigneeId }
        })
        if (!isMember) {
          return NextResponse.json({ error: '该用户不在任务工作区中，请先邀请 TA 成为协作伙伴' }, { status: 403 })
        }
      }
      updateData.assigneeId = newAssigneeId
      // 同步 StepAssignee 表
      if (newAssigneeId) {
        const user = await prisma.user.findUnique({
          where: { id: newAssigneeId },
          select: { agent: { select: { id: true } } }
        })
        await prisma.stepAssignee.deleteMany({ where: { stepId: id } })
        await prisma.stepAssignee.create({
          data: {
            stepId: id, userId: newAssigneeId,
            assigneeType: user?.agent ? 'agent' : 'human',
            isPrimary: true,
          }
        })
      } else {
        await prisma.stepAssignee.deleteMany({ where: { stepId: id } })
      }
    }
    if (data.completionMode !== undefined) {
      updateData.completionMode = data.completionMode
    }

    const updated = await prisma.taskStep.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } },
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } }
          }
        },
        attachments: true
      }
    })

    return NextResponse.json(updated)

  } catch (error) {
    console.error('更新步骤失败:', error)
    return NextResponse.json({ error: '更新步骤失败' }, { status: 500 })
  }
}

// DELETE /api/steps/[id] - 删除步骤
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await authenticate(req)
    
    if (!auth) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const step = await prisma.taskStep.findUnique({
      where: { id },
      include: { task: true }
    })

    if (!step) {
      return NextResponse.json({ error: '步骤不存在' }, { status: 404 })
    }

    // 只有任务创建者可以删除步骤
    if (step.task.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有任务创建者可以删除步骤' }, { status: 403 })
    }

    await prisma.taskStep.delete({
      where: { id }
    })

    return NextResponse.json({ message: '删除成功' })

  } catch (error) {
    console.error('删除步骤失败:', error)
    return NextResponse.json({ error: '删除步骤失败' }, { status: 500 })
  }
}
