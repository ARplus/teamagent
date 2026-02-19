import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/agent/pickup-token?agentId=xxx
 *
 * Agent 轮询拿 API Token（人类 claim 后存入 pendingApiToken）
 * 取到即清空——一次性机制
 *
 * 不需要认证（只有知道 agentId 的 Agent 才会来轮询）
 *
 * Response (等待中):
 *   { pending: true }
 *
 * Response (成功):
 *   { success: true, apiToken: "ta_xxx...", agentName: "Lobster" }
 */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')

  if (!agentId) {
    return NextResponse.json({ error: '请提供 agentId' }, { status: 400 })
  }

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        userId: true,
        pendingApiToken: true,
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }

    // 还没被 claim，继续等待
    if (!agent.pendingApiToken) {
      return NextResponse.json({
        pending: true,
        claimed: !!agent.userId,
        message: agent.userId ? '已认领但 token 已取走' : '等待人类认领中...'
      })
    }

    // 原子操作：只有当 pendingApiToken 仍为此值时才清空并返回（防竞态）
    const updated = await prisma.agent.updateMany({
      where: { id: agentId, pendingApiToken: agent.pendingApiToken },
      data: { pendingApiToken: null }
    })

    // 如果 count=0，说明已被其他请求先取走
    if (updated.count === 0) {
      return NextResponse.json({
        pending: true,
        claimed: true,
        message: '已认领但 token 已取走'
      })
    }

    return NextResponse.json({
      success: true,
      apiToken: agent.pendingApiToken,
      agentName: agent.name,
      message: '🎉 配对成功！Token 已领取，开始工作吧！'
    })

  } catch (error) {
    console.error('pickup-token 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
