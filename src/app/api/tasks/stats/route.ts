import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const [inProgress, done] = await Promise.all([
    prisma.task.count({
      where: {
        creatorId: user.id,
        status: { in: ['todo', 'in_progress'] },
      },
    }),
    prisma.task.count({
      where: {
        creatorId: user.id,
        status: 'done',
      },
    }),
  ])

  return NextResponse.json({ inProgress, done })
}
