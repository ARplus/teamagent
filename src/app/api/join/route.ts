import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/join?token=xxx — 预览邀请信息（未登录也可看）
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: '缺少 token' }, { status: 400 })

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
  if (invite.usedAt) return NextResponse.json({ error: '邀请链接已被使用' }, { status: 410 })

  return NextResponse.json({
    valid: true,
    inviter: invite.inviter,
    workspace: invite.workspace,
    task: invite.task,
    expiresAt: invite.expiresAt
  })
}

// POST /api/join — 接受邀请（需要登录）
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录后再接受邀请', needLogin: true }, { status: 401 })
  }

  const { token } = await req.json()
  if (!token) return NextResponse.json({ error: '缺少 token' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const invite = await prisma.inviteToken.findUnique({
    where: { token },
    include: { task: { select: { id: true, title: true } } }
  })

  if (!invite) return NextResponse.json({ error: '邀请链接无效' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: '邀请链接已过期' }, { status: 410 })
  if (invite.usedAt) return NextResponse.json({ error: '邀请链接已被使用' }, { status: 410 })

  // 检查是否已是工作区成员
  const existing = await prisma.workspaceMember.findFirst({
    where: { workspaceId: invite.workspaceId, userId: user.id }
  })

  if (!existing) {
    // 加入工作区
    await prisma.workspaceMember.create({
      data: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role }
    })
  }

  // 标记邀请已使用
  await prisma.inviteToken.update({
    where: { token },
    data: { usedAt: new Date() }
  })

  return NextResponse.json({
    message: `欢迎加入！你现在可以查看并参与任务了`,
    taskId: invite.taskId,
    taskTitle: invite.task?.title,
    workspaceId: invite.workspaceId
  })
}
