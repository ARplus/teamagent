import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// POST /api/workspace/invite — 邀请协作伙伴加入我的工作区
// 仅 owner 可邀请，避免协作关系被意外扩散
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  try {
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (!currentUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '请提供邮箱地址' }, { status: 400 })
    }

    const trimmedEmail = email.trim().toLowerCase()

    // 不能邀请自己
    if (trimmedEmail === currentUser.email) {
      return NextResponse.json({ error: '不能邀请自己哦 😄' }, { status: 400 })
    }

    // 只允许 owner 邀请，避免成员误拉人
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: currentUser.id, role: 'owner' },
      orderBy: { joinedAt: 'asc' }
    })

    if (!membership) {
      return NextResponse.json({ error: '只有工作区创建者可以邀请协作伙伴' }, { status: 403 })
    }

    const workspaceId = membership.workspaceId

    // 查找被邀请的用户
    const invitee = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      include: { agent: { select: { id: true, name: true } } }
    })
    if (!invitee) {
      return NextResponse.json({
        error: `用户 ${trimmedEmail} 尚未注册 TeamAgent，请让 TA 先注册账号`
      }, { status: 404 })
    }

    // 检查是否已经是工作区成员
    const existing = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: invitee.id }
    })
    if (existing) {
      return NextResponse.json({
        error: `${invitee.name || trimmedEmail} 已经是你的协作伙伴了`,
        alreadyMember: true
      }, { status: 400 })
    }

    // 加入工作区
    const newMember = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: invitee.id,
        role: 'member',
        memberSource: 'invite',
        addedByUserId: currentUser.id,
      },
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
      }
    })

    return NextResponse.json({
      message: `🤝 已邀请 ${invitee.name || trimmedEmail} 成为协作伙伴！`,
      member: {
        id: newMember.user.id,
        name: newMember.user.name,
        email: newMember.user.email,
        avatar: newMember.user.avatar,
        agent: newMember.user.agent
      }
    })

  } catch (error) {
    console.error('邀请协作伙伴失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
