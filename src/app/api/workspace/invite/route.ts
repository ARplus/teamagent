import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

// POST /api/workspace/invite — 邀请协作伙伴加入我的工作区
// 两种模式：
//   1. 带 email: 直接通过邮箱添加到工作区（需用户已注册）
//   2. 不带 email: 生成邀请链接（任何人可通过链接加入）
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

    // 找到当前用户的主工作区（owner 优先，否则任意所在工作区）
    let membership = await prisma.workspaceMember.findFirst({
      where: { userId: currentUser.id, role: 'owner' },
      orderBy: { joinedAt: 'asc' }
    })
    if (!membership) {
      membership = await prisma.workspaceMember.findFirst({
        where: { userId: currentUser.id },
        orderBy: { joinedAt: 'asc' }
      })
    }
    if (!membership) {
      return NextResponse.json({ error: '你还没有工作区' }, { status: 404 })
    }

    const workspaceId = membership.workspaceId

    // 尝试解析 body（可能为空）
    let body: { email?: string } = {}
    try {
      body = await req.json()
    } catch {
      // body 为空或无效 JSON → 生成邀请链接模式
    }

    const email = body.email?.trim().toLowerCase()

    // ========== 模式 2: 生成邀请链接（无 email）==========
    if (!email) {
      const token = crypto.randomBytes(24).toString('base64url')

      const invite = await prisma.inviteToken.create({
        data: {
          token,
          inviterId: currentUser.id,
          workspaceId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天有效
        }
      })

      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
      const inviteUrl = `${baseUrl}/join/${token}`

      console.log('[invite] workspace link generated:', inviteUrl)

      return NextResponse.json({
        inviteUrl,
        token,
        expiresAt: invite.expiresAt
      })
    }

    // ========== 模式 1: 直接通过邮箱添加 ==========

    // 不能邀请自己
    if (email === currentUser.email) {
      return NextResponse.json({ error: '不能邀请自己哦 😄' }, { status: 400 })
    }

    // 查找被邀请的用户
    const invitee = await prisma.user.findUnique({
      where: { email },
      include: { agent: { select: { id: true, name: true } } }
    })
    if (!invitee) {
      return NextResponse.json({
        error: `用户 ${email} 尚未注册 TeamAgent，请让 TA 先注册账号`
      }, { status: 404 })
    }

    // 检查是否已经是工作区成员
    const existing = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: invitee.id }
    })
    if (existing) {
      return NextResponse.json({
        error: `${invitee.name || email} 已经是你的协作伙伴了`,
        alreadyMember: true
      }, { status: 400 })
    }

    // 加入工作区
    const newMember = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: invitee.id,
        role: 'member'
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
      message: `🤝 已邀请 ${invitee.name || email} 成为协作伙伴！`,
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
