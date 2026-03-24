import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'

/**
 * POST /api/agent/rename
 * 主 Agent 为子 Agent 改名
 * Body: { agentId: string; newName: string }
 */
export async function POST(req: NextRequest) {
  let userId: string | null = null
  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) userId = tokenAuth.user.id
  if (!userId) {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      userId = u?.id || null
    }
  }
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const { agentId, newName } = await req.json()
  if (!agentId || !newName?.trim()) {
    return NextResponse.json({ error: '缺少 agentId 或 newName' }, { status: 400 })
  }

  // 找操作者的主 Agent
  const myAgent = await prisma.agent.findUnique({
    where: { userId },
    select: { id: true, isMainAgent: true }
  })
  if (!myAgent?.isMainAgent) {
    return NextResponse.json({ error: '只有主 Agent 可以给子 Agent 改名' }, { status: 403 })
  }

  // 目标 Agent 必须是自己的子 Agent
  const target = await prisma.agent.findFirst({
    where: { id: agentId, parentAgentId: myAgent.id },
    select: { id: true, name: true, userId: true }
  })
  if (!target) {
    return NextResponse.json({ error: '未找到子 Agent，或无权操作' }, { status: 404 })
  }

  const trimmed = newName.trim()

  // 同步更新 Agent 名和对应 User 名
  await prisma.agent.update({ where: { id: target.id }, data: { name: trimmed } })
  if (target.userId) {
    await prisma.user.update({ where: { id: target.userId }, data: { name: trimmed } })
  }

  console.log(`[Rename] ${myAgent.id} 将子 Agent ${target.name} → ${trimmed}`)

  return NextResponse.json({ success: true, agentId, newName: trimmed })
}
