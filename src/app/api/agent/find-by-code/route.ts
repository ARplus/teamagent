import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/agent/find-by-code?code=123456
 *
 * 通过6位配对码查找未认领的 Agent
 * 用于"输入配对码"功能，找到 agentId 后跳转到 /claim/[agentId]
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.trim()

  if (!code) {
    return NextResponse.json({ error: '请提供配对码' }, { status: 400 })
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: '配对码必须是6位数字' }, { status: 400 })
  }

  try {
    const agent = await prisma.agent.findFirst({
      where: {
        pairingCode: code,
        userId: null, // 未被认领
      },
      select: {
        id: true,
        name: true,
        status: true,
        pairingCodeExpiresAt: true,
        createdAt: true,
      }
    })

    if (!agent) {
      return NextResponse.json(
        { error: '配对码无效或 Agent 已被认领' },
        { status: 404 }
      )
    }

    // 检查是否过期
    if (agent.pairingCodeExpiresAt && agent.pairingCodeExpiresAt < new Date()) {
      return NextResponse.json(
        { error: '配对码已过期，请让 Agent 重新注册' },
        { status: 410 }
      )
    }

    return NextResponse.json({
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      createdAt: agent.createdAt,
    })

  } catch (error) {
    console.error('查找 Agent 失败:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
