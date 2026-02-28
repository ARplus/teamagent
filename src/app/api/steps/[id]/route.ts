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
    // 分配步骤：null 表示取消分配，string 表示分配给指定用户（人类或 Agent 所属用户）
    if (data.assigneeId !== undefined) {
      const newAssigneeId = data.assigneeId || null
      // 验证 assignee 是任务工作区的成员
      if (newAssigneeId) {
        const isMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: step.task.workspaceId, userId: newAssigneeId }
        })
        if (!isMember) {
          return NextResponse.json({ error: '该用户不在任务工作区中，请先邀请 TA 成为协作伙伴' }, { status: 403 })
        }
      }
      updateData.assigneeId = newAssigneeId
    }

    const updated = await prisma.taskStep.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true, agent: { select: { id: true, name: true, status: true } } } },
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
