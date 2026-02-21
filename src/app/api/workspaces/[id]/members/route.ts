import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// 验证当前用户是否是工作区 owner/admin
async function getWorkspaceAuth(workspaceId: string, userEmail: string) {
  const user = await prisma.user.findUnique({ where: { email: userEmail } })
  if (!user) return null

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id }
  })
  return membership ? { user, membership } : null
}

// GET /api/workspaces/[id]/members — 列出成员
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const auth = await getWorkspaceAuth(id, session.user.email)
  if (!auth) {
    return NextResponse.json({ error: '无权访问此工作区' }, { status: 403 })
  }

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          agent: { select: { id: true, name: true, status: true } }
        }
      }
    },
    orderBy: { joinedAt: 'asc' }
  })

  return NextResponse.json({ members })
}

// POST /api/workspaces/[id]/members — 邀请成员（by email）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const auth = await getWorkspaceAuth(id, session.user.email)
  if (!auth) {
    return NextResponse.json({ error: '无权操作此工作区' }, { status: 403 })
  }

  // 只有 owner 可以邀请
  if (auth.membership.role !== 'owner') {
    return NextResponse.json({ error: '只有工作区 Owner 可以邀请成员' }, { status: 403 })
  }

  const { email, role = 'member' } = await req.json()
  if (!email) {
    return NextResponse.json({ error: '请提供邮箱' }, { status: 400 })
  }

  // 查找被邀请的用户
  const invitee = await prisma.user.findUnique({ where: { email } })
  if (!invitee) {
    return NextResponse.json({
      error: `用户 ${email} 尚未注册 TeamAgent，请让他们先注册`
    }, { status: 404 })
  }

  // 检查是否已经是成员
  const existing = await prisma.workspaceMember.findFirst({
    where: { workspaceId: id, userId: invitee.id }
  })
  if (existing) {
    return NextResponse.json({ error: '该用户已经是工作区成员' }, { status: 400 })
  }

  // 加入工作区
  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId: id,
      userId: invitee.id,
      role
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          agent: { select: { id: true, name: true, status: true } }
        }
      }
    }
  })

  return NextResponse.json({
    message: `✅ 已邀请 ${invitee.name || email} 加入工作区`,
    member
  })
}

// DELETE /api/workspaces/[id]/members — 移除成员（body: { userId }）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const auth = await getWorkspaceAuth(id, session.user.email)
  if (!auth || auth.membership.role !== 'owner') {
    return NextResponse.json({ error: '只有 Owner 可以移除成员' }, { status: 403 })
  }

  const { userId } = await req.json()

  // 不能移除自己
  if (userId === auth.user.id) {
    return NextResponse.json({ error: '不能移除自己' }, { status: 400 })
  }

  await prisma.workspaceMember.deleteMany({
    where: { workspaceId: id, userId }
  })

  return NextResponse.json({ message: '成员已移除' })
}
