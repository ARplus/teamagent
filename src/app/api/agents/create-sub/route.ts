import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
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
 * POST /api/agents/create-sub
 *
 * 批量创建子 Agent（影子军团模式）
 * Body: { count: number }  // 1-10
 *
 * 创建骨架：User(isVirtual) + Agent(placeholder) + WorkspaceMember(shadow) + ApiToken
 * 名字/soul/personality 由 Lobster 后续 PATCH 设定
 * 主 Watch 用 isolated session 扮演子 Agent 执行步骤（形神分离）
 */
export async function POST(req: NextRequest) {
  let userId: string | null = null

  const tokenAuth = await authenticateRequest(req)
  if (tokenAuth) {
    userId = tokenAuth.user.id
  } else {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      userId = u?.id || null
    }
  }

  if (!userId) {
    return NextResponse.json({ error: '请先登录或提供 API Token' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      agent: true,
      workspaces: { include: { workspace: true }, take: 1 }
    }
  })

  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  if (!user.agent) return NextResponse.json({ error: '请先配对主 Agent，才能创建子 Agent' }, { status: 400 })
  if (user.agent.parentAgentId) return NextResponse.json({ error: '子 Agent 不能创建子 Agent' }, { status: 403 })

  if (!user.agent.isMainAgent) {
    await prisma.agent.update({ where: { id: user.agent.id }, data: { isMainAgent: true } })
  }

  const workspace = user.workspaces[0]?.workspace
  if (!workspace) return NextResponse.json({ error: '未找到工作区' }, { status: 400 })

  const body = await req.json()
  const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 10)

  try {
    // 预生成所有密码和 token（bcrypt CPU 密集，在事务外执行）
    const preparations = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const suffix = crypto.randomBytes(3).toString('hex')
        const autoEmail = `sub-${suffix}@agent.teamagent.local`
        const autoPassword = crypto.randomBytes(12).toString('hex')
        const hashedPwd = await bcrypt.hash(autoPassword, 6)
        const rawToken = generateToken()
        const hashedToken = hashToken(rawToken)
        return { index: i + 1, autoEmail, hashedPwd, rawToken, hashedToken }
      })
    )

    const results = await prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; name: string; token: string }> = []

      for (const prep of preparations) {
        const placeholderName = `sub-${prep.index}`

        const subUser = await tx.user.create({
          data: { email: prep.autoEmail, password: prep.hashedPwd, name: placeholderName, isVirtual: true }
        })

        const subAgent = await tx.agent.create({
          data: {
            name: placeholderName,
            userId: subUser.id,
            status: 'offline',
            capabilities: JSON.stringify([]),
            soul: null,
            isMainAgent: false,
            claimedAt: new Date(),
            parentAgentId: user.agent!.id,
            onboardingStatus: 'training',
          }
        })

        await tx.workspaceMember.create({
          data: {
            userId: subUser.id,
            workspaceId: workspace.id,
            role: 'shadow',
            memberSource: 'agent_register',
            addedByUserId: user.id,
          }
        })

        await tx.apiToken.create({
          data: { token: prep.hashedToken, name: `${placeholderName}-Token`, userId: subUser.id }
        })

        created.push({ id: subAgent.id, name: placeholderName, token: prep.rawToken })
      }

      return created
    })

    sendToUser(user.id, {
      type: 'agents:batch-created',
      parentAgentId: user.agent.id,
      agents: results.map(r => ({ id: r.id, name: r.name, token: r.token })),
    } as any)
    console.log(`[CreateSub] ✅ 批量创建 ${count} 个子 Agent（影子军团），已发 SSE`)

    return NextResponse.json({
      success: true,
      message: `已创建 ${count} 个子 Agent`,
      agents: results,
    }, { status: 201 })
  } catch (error) {
    console.error('[CreateSub] 批量创建子 Agent 失败:', error)
    return NextResponse.json({ error: '创建失败' }, { status: 500 })
  }
}
