import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/workspaces/my — 获取当前用户的主工作区
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email }
  })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  // 找到用户作为 owner 的工作区（主工作区）
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id, role: 'owner' },
    include: {
      workspace: {
        select: { id: true, name: true, description: true, createdAt: true }
      }
    },
    orderBy: { joinedAt: 'asc' }
  })

  if (!membership) {
    return NextResponse.json({ error: '未找到工作区' }, { status: 404 })
  }

  return NextResponse.json({ workspace: membership.workspace })
}
