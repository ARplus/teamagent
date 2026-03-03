import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/invite/[token] — 查询邀请信息（未登录也能看）
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const invite = await prisma.inviteToken.findUnique({
    where: { token },
    include: {
      inviter: { select: { name: true, avatar: true } },
      workspace: { select: { name: true } },
      task: { select: { id: true, title: true, description: true, status: true } }
    }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '此邀请链接已被使用' }, { status: 410 })

  return NextResponse.json({
    valid: true,
    inviter: invite.inviter,
    workspace: invite.workspace,
    task: invite.task,
    expiresAt: invite.expiresAt
  })
}

// POST /api/invite/[token] — 接受邀请（需要登录）
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录后再接受邀请', needLogin: true }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const invite = await prisma.inviteToken.findUnique({
    where: { token },
    include: { task: true }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '此邀请链接已被使用' }, { status: 410 })

  const existing = await prisma.workspaceMember.findFirst({
    where: { workspaceId: invite.workspaceId, userId: user.id }
  })

  await prisma.$transaction(async (tx) => {
    if (!existing) {
      await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
          memberSource: 'invite_link',
          addedByUserId: invite.inviterId,
        }
      })
    }
    // 记录接受邀请者，用于任务可见性（即使没有步骤也能看到被分享的任务）
    await tx.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), inviteeId: user.id }
    })
  })

  return NextResponse.json({
    message: '🎉 欢迎加入！',
    taskId: invite.taskId,
    workspaceId: invite.workspaceId,
    alreadyMember: !!existing
  })
}
