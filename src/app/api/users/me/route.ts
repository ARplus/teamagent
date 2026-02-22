import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

// PATCH /api/users/me — 更新当前用户资料
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { name, nickname } = await req.json()

    const user = await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ...(name !== undefined && { name }),
        ...(nickname !== undefined && { nickname }),
      },
      select: { id: true, name: true, nickname: true, email: true }
    })

    return NextResponse.json(user)
  } catch (error) {
    console.error('更新用户资料失败:', error)
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }
}
