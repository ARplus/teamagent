import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

// 生成 API Token
function generateToken(): string {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * POST /api/agent/claim
 * 
 * 人类认领 Agent
 * 
 * Body:
 * {
 *   "pairingCode": "123456",     // 方式1：使用配对码
 *   // 或
 *   "agentId": "xxx"             // 方式2：直接使用 Agent ID（需要配对码未过期）
 * }
 * 
 * 需要登录（Session）
 * 
 * Response:
 * {
 *   "success": true,
 *   "agent": { ... },
 *   "apiToken": "ta_xxx..."      // 新生成的 API Token
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: '请先登录' },
        { status: 401 }
      )
    }

    // 获取当前用户
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { agent: true }
    })

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    // 如果用户已有 Agent，解绑旧的（支持重装后重新配对）
    let replacedAgent: string | null = null
    if (user.agent) {
      replacedAgent = user.agent.name
      await prisma.agent.update({
        where: { id: user.agent.id },
        data: {
          userId: null,
          claimedAt: null,
          status: 'offline',
          isMainAgent: false,
        }
      })
      console.log(`[Claim] 用户 ${user.id} 解绑旧 Agent "${replacedAgent}"，准备配对新 Agent`)
    }

    const body = await req.json()
    const { pairingCode, agentId } = body

    if (!pairingCode && !agentId) {
      return NextResponse.json(
        { error: '请提供配对码或 Agent ID' },
        { status: 400 }
      )
    }

    // 查找 Agent
    let agent
    if (pairingCode) {
      agent = await prisma.agent.findUnique({
        where: { pairingCode }
      })
    } else {
      agent = await prisma.agent.findUnique({
        where: { id: agentId }
      })
    }

    if (!agent) {
      return NextResponse.json(
        { error: '配对码无效或 Agent 不存在' },
        { status: 404 }
      )
    }

    // 检查是否已被认领
    if (agent.userId) {
      return NextResponse.json(
        { error: 'Agent 已被其他人认领' },
        { status: 409 }
      )
    }

    // 检查配对码是否过期
    if (agent.pairingCodeExpiresAt && new Date() > agent.pairingCodeExpiresAt) {
      return NextResponse.json(
        { error: '配对码已过期，请让 Agent 重新注册' },
        { status: 410 }
      )
    }

    // 生成 API Token
    const rawToken = generateToken()
    const hashedToken = hashToken(rawToken)

    // 事务：绑定 Agent 并创建 Token
    const [updatedAgent, apiToken] = await prisma.$transaction([
      // 更新 Agent，绑定到用户，同时存 pendingApiToken 供 Agent 轮询取走
      prisma.agent.update({
        where: { id: agent.id },
        data: {
          userId: user.id,
          claimedAt: new Date(),
          pairingCode: null,
          pairingCodeExpiresAt: null,
          pendingApiToken: rawToken  // Agent 轮询 /pickup-token 取走即删
        }
      }),
      // 创建 API Token
      prisma.apiToken.create({
        data: {
          token: hashedToken,
          name: `${agent.name}-Token`,
          userId: user.id
        }
      })
    ])

    // 🆕 自动设置 isMainAgent：该用户还没有主 Agent 时，认领的第一个自动成为主 Agent
    try {
      const userMainAgentCount = await prisma.agent.count({
        where: { userId: user.id, isMainAgent: true }
      })
      if (userMainAgentCount === 0) {
        await prisma.agent.update({
          where: { id: updatedAgent.id },
          data: { isMainAgent: true }
        })
        console.log(`[isMainAgent] ${agent.name} 自动设为 ${user.id} 的主 Agent`)
      }
    } catch (e) {
      // 非致命错误，不影响认领流程
      console.warn('[isMainAgent] 自动设置失败:', e)
    }

    // 🆕 自动报名 M0 必修课（fire-and-forget，不影响认领主流程）
    const M0_TEMPLATE_ID = 'cmmwzpb3k0013v7541hwsz8ab' // TeamAgent 基础入门
    prisma.courseEnrollment.upsert({
      where: { userId_templateId: { userId: user.id, templateId: M0_TEMPLATE_ID } },
      update: {},
      create: {
        userId: user.id,
        templateId: M0_TEMPLATE_ID,
        status: 'active',
        paidTokens: 0,
        enrolledByAgentId: updatedAgent.id,
      }
    }).then(() => {
      console.log(`[Claim] 自动报名 M0 → userId ${user.id}`)
    }).catch(e => {
      console.warn('[Claim] M0 自动报名失败（非致命）:', e)
    })

    return NextResponse.json({
      success: true,
      message: replacedAgent
        ? `🔄 已替换旧 Agent「${replacedAgent}」，${agent.name} 现在是你的新 Agent！`
        : `🎉 恭喜！${agent.name} 已成为你的 Agent！`,
      replacedAgent,
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        status: updatedAgent.status,
        claimedAt: updatedAgent.claimedAt
      },
      apiToken: rawToken,  // 返回原始 Token（仅此一次！）
      warning: '⚠️ 请保存好 API Token，它只会显示一次！'
    })

  } catch (error) {
    console.error('Agent 认领失败:', error)
    return NextResponse.json(
      { error: '认领失败，请重试' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agent/claim?code=xxx
 * 
 * 查询配对码信息（不需要登录）
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const agentId = searchParams.get('agentId')

  if (!code && !agentId) {
    return NextResponse.json(
      { error: '请提供配对码或 Agent ID' },
      { status: 400 }
    )
  }

  let agent
  if (code) {
    agent = await prisma.agent.findUnique({
      where: { pairingCode: code }
    })
  } else {
    agent = await prisma.agent.findUnique({
      where: { id: agentId! }
    })
  }

  if (!agent) {
    return NextResponse.json(
      { error: '配对码无效或 Agent 不存在' },
      { status: 404 }
    )
  }

  if (agent.userId) {
    return NextResponse.json({
      claimed: true,
      message: 'Agent 已被认领'
    })
  }

  if (agent.pairingCodeExpiresAt && new Date() > agent.pairingCodeExpiresAt) {
    return NextResponse.json({
      expired: true,
      message: '配对码已过期'
    })
  }

  return NextResponse.json({
    claimed: false,
    expired: false,
    agent: {
      id: agent.id,
      name: agent.name,
      createdAt: agent.createdAt
    },
    expiresAt: agent.pairingCodeExpiresAt
  })
}
