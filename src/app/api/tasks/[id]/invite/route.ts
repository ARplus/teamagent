import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

// POST /api/tasks/[id]/invite — 生成任务邀请链接
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  // 验证任务存在且属于当前用户的工作区
  const task = await prisma.task.findFirst({
    where: {
      id: params.id,
      workspace: { members: { some: { userId: user.id, role: 'owner' } } }
    },
    include: { workspace: true }
  })
  if (!task) return NextResponse.json({ error: '任务不存在或无权操作' }, { status: 403 })

  // 生成唯一 token
  const token = crypto.randomBytes(24).toString('base64url')

  const invite = await prisma.inviteToken.create({
    data: {
      token,
      inviterId: user.id,
      workspaceId: task.workspaceId,
      taskId: task.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天有效
    }
  })

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const inviteUrl = `${baseUrl}/join/${token}`

  return NextResponse.json({
    inviteUrl,
    token,
    expiresAt: invite.expiresAt,
    taskTitle: task.title
  })
}
