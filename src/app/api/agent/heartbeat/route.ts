import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

/**
 * POST /api/agent/heartbeat
 * Agent Worker 每 60s 调用一次，更新 lastHeartbeatAt
 * 同时根据是否有真实 in_progress 步骤，准确设置 working / online
 *
 * 状态规则：
 *   - 有 in_progress 步骤 → working（真的在干活）
 *   - 没有             → online（空闲待命）
 *   - 无心跳 >3min    → offline（由 status 查询懒判断）
 */
export async function POST(req: NextRequest) {
  try {
    const tokenAuth = await authenticateRequest(req)
    if (!tokenAuth) {
      return NextResponse.json({ error: '需要 API Token' }, { status: 401 })
    }

    const userId = tokenAuth.user.id

    // 找到该用户的 Agent
    const agent = await prisma.agent.findUnique({
      where: { userId },
      select: { id: true, status: true },
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
    }

    // 检查是否真的有步骤在执行中
    const activeStep = await prisma.taskStep.findFirst({
      where: { assigneeId: userId, status: 'in_progress' },
      select: { id: true, title: true },
    })

    const realStatus = activeStep ? 'working' : 'online'

    // 更新心跳时间 + 真实状态（paused 状态不覆盖，保持暂停）
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        lastHeartbeatAt: new Date(),
        ...(agent.status !== 'paused' ? { status: realStatus } : {}),
      },
    })

    return NextResponse.json({
      ok: true,
      status: realStatus,
      activeStep: activeStep ? activeStep.title : null,
      ts: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Agent/Heartbeat] 失败:', error)
    return NextResponse.json({ error: '心跳更新失败' }, { status: 500 })
  }
}
