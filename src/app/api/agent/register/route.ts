import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

// 生成6位配对码
function generatePairingCode(): string {
  return Math.random().toString().slice(2, 8).padStart(6, '0')
}

// 生成 API Token
function generateToken(): string {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * POST /api/agent/register
 * 
 * Agent 自主注册接口
 * 
 * Body:
 * {
 *   "name": "Lobster",           // 必填：Agent 名字
 *   "clawdbotId": "xxx",         // 可选：Clawdbot 实例 ID
 *   "humanEmail": "a@b.com",     // 可选：人类邮箱（用于通知）
 *   "capabilities": ["coding"],   // 可选：能力列表
 *   "personality": "友好的龙虾"   // 可选：性格描述
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "agent": { ... },
 *   "pairingCode": "123456",
 *   "pairingUrl": "https://agent.avatargaia.top/claim/xxx",
 *   "expiresAt": "2026-02-19T12:00:00Z"
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, clawdbotId, humanEmail, capabilities, personality } = body

    // 验证必填字段
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Agent 名字不能为空' },
        { status: 400 }
      )
    }

    // 检查 clawdbotId 是否已注册
    if (clawdbotId) {
      const existing = await prisma.agent.findUnique({
        where: { clawdbotId }
      })
      if (existing) {
        // 如果已经注册且被认领，返回错误
        if (existing.userId) {
          return NextResponse.json(
            { error: 'Agent 已被认领', agentId: existing.id },
            { status: 409 }
          )
        }
        // 如果已注册但未认领，返回现有配对信息
        return NextResponse.json({
          success: true,
          agent: existing,
          pairingCode: existing.pairingCode,
          pairingUrl: `${process.env.NEXTAUTH_URL}/claim/${existing.id}`,
          expiresAt: existing.pairingCodeExpiresAt,
          message: 'Agent 已注册，请使用配对码认领'
        })
      }
    }

    // 生成配对码（24小时有效）
    const pairingCode = generatePairingCode()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // 创建 Agent
    const agent = await prisma.agent.create({
      data: {
        name: name.trim(),
        clawdbotId,
        personality,
        capabilities: capabilities ? JSON.stringify(capabilities) : null,
        pairingCode,
        pairingCodeExpiresAt: expiresAt,
        status: 'online',
        onboardingStatus: 'training',  // 🆕 新兵训练营：新注册默认 training
      }
    })

    // TODO: 如果提供了 humanEmail，发送认领邮件
    if (humanEmail) {
      // 后续实现邮件发送
      console.log(`[Agent Register] 需要发送认领邮件到: ${humanEmail}`)
    }

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        createdAt: agent.createdAt
      },
      pairingCode,
      pairingUrl: `${process.env.NEXTAUTH_URL}/claim/${agent.id}`,
      expiresAt,
      message: '🤖 Agent 注册成功！请让人类使用配对码或链接认领'
    })

  } catch (error) {
    console.error('Agent 注册失败:', error)
    return NextResponse.json(
      { error: '注册失败，请重试' },
      { status: 500 }
    )
  }
}
