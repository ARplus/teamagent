import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/join/[token] — 查询邀请信息（未登录也可预览）
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const invite = await prisma.inviteToken.findUnique({
    where: { token: params.token },
    include: {
      inviter: { select: { id: true, name: true, avatar: true } },
      workspace: { select: { id: true, name: true } },
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
    task: invite.task
  })
}

// POST /api/join/[token] — 接受邀请（需要登录）
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录后接受邀请', needLogin: true }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const invite = await prisma.inviteToken.findUnique({
    where: { token: params.token },
    include: { task: true }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '此邀请链接已被使用' }, { status: 410 })

  // 不能接受自己的邀请
  if (invite.inviterId === user.id) {
    return NextResponse.json({ error: '不能接受自己发出的邀请' }, { status: 400 })
  }

  // 加入工作区（如已是成员则跳过）
  await prisma.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
    update: {},
    create: { userId: user.id, workspaceId: invite.workspaceId, role: 'member' }
  })

  // 标记邀请已使用
  await prisma.inviteToken.update({
    where: { token: params.token },
    data: { usedAt: new Date() }
  })

  return NextResponse.json({
    success: true,
    message: '已成功加入工作区！',
    taskId: invite.taskId,
    workspaceId: invite.workspaceId
  })
}
