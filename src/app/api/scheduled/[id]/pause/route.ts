import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

async function authenticate(req: NextRequest) {
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) return { userId: tokenAuth.user.id, user: tokenAuth.user }
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (user) return { userId: user.id, user }
  }
  return null
}

// POST /api/scheduled/:id/pause — 暂停模板
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.taskTemplate.findUnique({ where: { id } })

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }
    if (template.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以暂停' }, { status: 403 })
    }

    const updated = await prisma.taskTemplate.update({
      where: { id },
      data: { scheduleEnabled: false, nextRunAt: null },
    })

    console.log(`[Scheduled/Pause] 暂停模板: "${template.name}"`)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Scheduled/Pause] 失败:', error)
    return NextResponse.json({ error: '暂停失败' }, { status: 500 })
  }
}
