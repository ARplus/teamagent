import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateRequest } from '@/lib/api-auth'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

function generateToken(): string {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}
function hashToken(t: string): string {
  return crypto.createHash('sha256').update(t).digest('hex')
}

/**
 * POST /api/agents/register
 *
 * 主 Agent 代替工作区批量注册子 Agent 成员
 *
 * 需要: Bearer token (主 Agent)
 * Body: {
 *   name: string           // Agent 展示名，如 "🦉 Athena 智慧猫头鹰"
 *   email: string          // 登录邮箱
 *   password?: string      // 默认 "lobster-agent-2026"
 *   capabilities?: string[]// 能力标签，如 ["文献综述","学术写作"]
 *   personality?: string   // 个性描述
 * }
 *
 * Returns: { agentId, userId, email, name, token, pairingCode }
 */
export async function POST(req: NextRequest) {
  // 1. 鉴权：需要是已注册的 Agent
  const auth = await authenticateRequest(req)
  if (!auth) {
    return NextResponse.json({ error: '需要 Agent token 鉴权' }, { status: 401 })
  }

  const callerAgent = await prisma.agent.findUnique({
    where: { userId: auth.user.id },
    include: {
      user: {
        include: {
          workspaces: { include: { workspace: true }, take: 1 }
        }
      }
    }
  })

  if (!callerAgent || !callerAgent.user) {
    return NextResponse.json({ error: '调用方未绑定 Agent' }, { status: 403 })
  }

  // 获取工作区
  const workspace = callerAgent.user.workspaces[0]?.workspace
  if (!workspace) {
    return NextResponse.json({ error: '未找到工作区' }, { status: 404 })
  }

  // 2. 解析请求体
  const body = await req.json()
  const {
    name,
    email,
    password = 'lobster-agent-2026',
    capabilities = [],
    personality,
  } = body

  if (!name || !email) {
    return NextResponse.json({ error: '缺少 name 或 email' }, { status: 400 })
  }

  // 3. 检查邮箱是否已存在
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: `邮箱 ${email} 已被注册` }, { status: 409 })
  }

  // 4. 创建用户 + Agent + 工作区成员 + API Token（事务）
  const hashedPwd = await bcrypt.hash(password, 10)
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)

  const result = await prisma.$transaction(async (tx) => {
    // 创建用户
    const user = await tx.user.create({
      data: {
        email,
        password: hashedPwd,
        name,
      }
    })

    // 创建 Agent（记录归属链：子Agent → 调用方主Agent）
    const agent = await tx.agent.create({
      data: {
        name,
        userId: user.id,
        status: 'online',
        capabilities: JSON.stringify(capabilities),
        personality: personality || null,
        isMainAgent: false,
        claimedAt: new Date(),
        parentAgentId: callerAgent.id,
      }
    })

    // 加入工作区
    await tx.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: 'member',
      }
    })

    // 创建 API Token
    await tx.apiToken.create({
      data: {
        token: hashedToken,
        name: `${name}-Token`,
        userId: user.id,
      }
    })

    return { user, agent }
  })

  return NextResponse.json({
    success: true,
    message: `🎉 ${name} 已成功加入 ${workspace.name}！`,
    agentId: result.agent.id,
    userId: result.user.id,
    email,
    name,
    token: rawToken,       // ⚠️ 仅此一次，请保存
    workspaceName: workspace.name,
  }, { status: 201 })
}
