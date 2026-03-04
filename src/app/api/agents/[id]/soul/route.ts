import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * PATCH /api/agents/[id]/soul — 更新 Agent 的 SOUL 文本
 *
 * Auth: Session（必须是 Agent 拥有者）
 * Body: { soul: string }  max 5000 chars
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 验证 Agent 存在且属于当前用户
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, userId: true }
    })
    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }
    if (agent.userId !== user.id) {
      return NextResponse.json({ error: '无权修改此 Agent' }, { status: 403 })
    }

    const body = await req.json()
    const soul = typeof body.soul === 'string' ? body.soul.trim() : ''

    if (soul.length > 5000) {
      return NextResponse.json({ error: 'SOUL 文本不能超过 5000 字符' }, { status: 400 })
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { soul: soul || null },
      select: { id: true, soul: true, growthXP: true, growthLevel: true }
    })

    return NextResponse.json({ agent: updated })
  } catch (error) {
    console.error('更新 SOUL 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
