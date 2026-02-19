import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

// POST /api/tasks/[id]/invite — 生成邀请链接
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const task = await prisma.task.findFirst({
    where: { id: params.id, creatorId: user.id }
  })
  if (!task) return NextResponse.json({ error: '任务不存在或无权操作' }, { status: 404 })

  // 生成邀请 token（7天有效）
  const token = crypto.randomBytes(24).toString('hex')
  const invite = await prisma.inviteToken.create({
    data: {
      token,
      inviterId: user.id,
      workspaceId: task.workspaceId,
      taskId: task.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  })

  const baseUrl = req.headers.get('origin') || 'http://localhost:3000'
  return NextResponse.json({
    inviteUrl: `${baseUrl}/join/${token}`,
    token,
    expiresAt: invite.expiresAt
  })
}
