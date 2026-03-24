import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// POST /api/user/heartbeat — 更新用户最后在线时间
// 前端每 60s 调用一次，用于判断人类在线状态
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: { lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
