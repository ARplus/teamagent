import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import { sendToUser } from '@/lib/events'

/**
 * POST /api/agent/pause
 * 暂停 Agent（发送 agent:paused SSE 事件使 Watch 退出）
 * Body: { agentId?: string }  — 不传则暂停自己；管理员可传 agentId 暂停任意 Agent
 *
 * POST /api/agent/pause  { resume: true }  — 恢复（设置 online）
 */
export async function POST(req: NextRequest) {
  // 认证
  let userId: string | null = null

  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    userId = tokenAuth.user.id
  } else {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      userId = user?.id ?? null
    }
  }
  if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { agentId, resume } = body

  let targetUserId = userId

  // 如果传了 agentId，验证当前用户是管理员或是该 Agent 的主人
  if (agentId) {
    const targetAgent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true, parentAgentId: true }
    })
    if (!targetAgent) return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })

    // 允许：自己的 Agent 或 自己的子 Agent（parentAgent 归属于自己的主 Agent）
    const isOwner = targetAgent.userId === userId
    const isParent = targetAgent.parentAgentId
      ? !!(await prisma.agent.findFirst({ where: { id: targetAgent.parentAgentId, userId } }))
      : false

    if (!isOwner && !isParent) {
      // 最后检查是否是 workspace admin
      const workspaceMember = await prisma.workspaceMember.findFirst({
        where: { userId, role: { in: ['owner', 'admin'] } }
      })
      if (!workspaceMember) return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    if (!targetAgent.userId) return NextResponse.json({ error: 'Agent 没有关联用户' }, { status: 400 })
    targetUserId = targetAgent.userId
  }

  if (resume) {
    // 恢复：设置为 online
    await prisma.agent.updateMany({ where: { userId: targetUserId }, data: { status: 'online' } })
    sendToUser(targetUserId, { type: 'agent:resumed' } as any)
    return NextResponse.json({ ok: true, action: 'resumed' })
  } else {
    // 暂停：设置为 paused + 发送 SSE 事件触发 Watch 退出
    await prisma.agent.updateMany({ where: { userId: targetUserId }, data: { status: 'paused' } })
    sendToUser(targetUserId, {
      type: 'agent:paused',
      reason: '管理员已暂停 Agent，Watch 自动退出。运行 teamagent resume 恢复。',
    } as any)
    console.log(`[AgentPause] userId=${targetUserId} 已暂停`)
    return NextResponse.json({ ok: true, action: 'paused' })
  }
}
