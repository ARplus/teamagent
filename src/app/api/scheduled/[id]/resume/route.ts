import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { computeNextRun } from '@/lib/cron-utils'

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

// POST /api/scheduled/:id/resume — 恢复模板
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params
    const template = await prisma.scheduledTemplate.findUnique({ where: { id } })

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }
    if (template.creatorId !== auth.userId) {
      return NextResponse.json({ error: '只有创建者可以恢复' }, { status: 403 })
    }

    const nextRunAt = computeNextRun(template.schedule, template.timezone)

    const updated = await prisma.scheduledTemplate.update({
      where: { id },
      data: { enabled: true, nextRunAt, failCount: 0 },
    })

    console.log(`[Scheduled/Resume] 恢复模板: "${template.title}", 下次执行: ${nextRunAt}`)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Scheduled/Resume] 失败:', error)
    return NextResponse.json({ error: '恢复失败' }, { status: 500 })
  }
}
