import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// PATCH /api/workspaces/[id] — 更新工作区设置
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 401 })

    const { id } = await params

    // 检查权限：owner 或 admin
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id, workspaceId: id, role: { in: ['owner', 'admin'] } },
    })
    if (!membership) {
      return NextResponse.json({ error: '只有管理员可以修改工作区设置' }, { status: 403 })
    }

    const body = await req.json()
    const updateData: any = {}

    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.type !== undefined) {
      updateData.type = body.type
      // 切换为 organization 时，默认 orgType=academy
      if (body.type === 'organization' && !body.orgType) {
        updateData.orgType = 'academy'
      }
      // 切换回 normal 时，清空 orgType
      if (body.type === 'normal') {
        updateData.orgType = null
      }
    }
    if (body.orgType !== undefined) updateData.orgType = body.orgType

    const updated = await prisma.workspace.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, description: true, type: true, orgType: true },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Workspaces/PATCH/:id] 失败:', error)
    return NextResponse.json({ error: '更新工作区失败' }, { status: 500 })
  }
}

// GET /api/workspaces/[id] — 获取工作区详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 401 })

    const { id } = await params

    // 检查是否是成员
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id, workspaceId: id },
    })
    if (!membership) {
      return NextResponse.json({ error: '你不是该工作区成员' }, { status: 403 })
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        orgType: true,
        createdAt: true,
        _count: { select: { members: true, tasks: true, taskTemplates: true } },
      },
    })

    if (!workspace) {
      return NextResponse.json({ error: '工作区不存在' }, { status: 404 })
    }

    return NextResponse.json({ ...workspace, myRole: membership.role })
  } catch (error) {
    console.error('[Workspaces/GET/:id] 失败:', error)
    return NextResponse.json({ error: '获取工作区失败' }, { status: 500 })
  }
}
