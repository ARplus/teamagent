import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { executeScheduledTemplate } from '@/lib/scheduled-executor'

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

// POST /api/scheduled/:id/run — 立即触发一次执行
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req)
    if (!auth) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const { id } = await params

    // 检查模板存在 + 权限
    const template = await prisma.taskTemplate.findUnique({ where: { id } })
    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 })
    }

    const isMember = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId, workspaceId: template.workspaceId },
    })
    if (!isMember) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const result = await executeScheduledTemplate(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Scheduled/Run] 失败:', error)
    return NextResponse.json({ error: '执行失败' }, { status: 500 })
  }
}
