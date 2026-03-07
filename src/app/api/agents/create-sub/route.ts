import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendToUser } from '@/lib/events'
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
 * 用户通过 Web 页面创建子 Agent（需要 session 登录）
 * Body: {
 *   name: string           // Agent 展示名
 *   capabilities?: string[]// 能力标签
 *   personality?: string   // 个性描述
 * }
 *
 * 自动生成邮箱和密码，创建 User + Agent + WorkspaceMember + ApiToken
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      agent: true,
      workspaces: { include: { workspace: true }, take: 1 }
    }
  })

  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }

  if (!user.agent) {
    return NextResponse.json({ error: '请先配对主 Agent，才能创建子 Agent' }, { status: 400 })
  }

  // 子 Agent 不能再创建子 Agent
  if (user.agent.parentAgentId) {
    return NextResponse.json({ error: '子 Agent 不能创建子 Agent' }, { status: 403 })
  }

  // 自动修正 isMainAgent（claim 时可能因竞态未设置成功）
  if (!user.agent.isMainAgent) {
    await prisma.agent.update({
      where: { id: user.agent.id },
      data: { isMainAgent: true }
    })
    console.log(`[CreateSub] 自动修正 ${user.agent.name} 的 isMainAgent 为 true`)
  }

  const workspace = user.workspaces[0]?.workspace
  if (!workspace) {
    return NextResponse.json({ error: '未找到工作区' }, { status: 400 })
  }

  const { name, capabilities = [], personality } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: '请输入 Agent 名称' }, { status: 400 })
  }

  // 自动生成唯一邮箱
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'agent'
  const suffix = crypto.randomBytes(3).toString('hex')
  const autoEmail = `${slug}-${suffix}@agent.teamagent.local`
  const autoPassword = crypto.randomBytes(12).toString('hex')

  const hashedPwd = await bcrypt.hash(autoPassword, 10)
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 创建虚拟用户
      const subUser = await tx.user.create({
        data: {
          email: autoEmail,
          password: hashedPwd,
          name: name.trim(),
        }
      })

      // 创建 Agent（归属链: 子Agent → 当前用户的主Agent）
      const subAgent = await tx.agent.create({
        data: {
          name: name.trim(),
          userId: subUser.id,
          status: 'offline',
          capabilities: JSON.stringify(capabilities),
          personality: personality?.trim() || null,
          isMainAgent: false,
          claimedAt: new Date(),
          parentAgentId: user.agent!.id,
        }
      })

      // 加入工作区
      await tx.workspaceMember.create({
        data: {
          userId: subUser.id,
          workspaceId: workspace.id,
          role: 'member',
          memberSource: 'agent_register',
          addedByUserId: user.id,
        }
      })

      // 创建 API Token
      await tx.apiToken.create({
        data: {
          token: hashedToken,
          name: `${name.trim()}-Token`,
          userId: subUser.id,
        }
      })

      return { subUser, subAgent }
    })

    // 🆕 通知主 Agent：新子 Agent 已在 TeamAgent 注册，需要在 OpenClaw 中创建
    const capsText = capabilities.length > 0 ? capabilities.join('、') : '通用'
    const notifyContent = `🤖 新子 Agent「${name.trim()}」已在 TeamAgent 注册成功！\n\n` +
      `- agentId: ${result.subAgent.id}\n` +
      `- 能力: ${capsText}\n` +
      `${personality ? `- 性格: ${personality.trim()}\n` : ''}` +
      `\n请按照 SKILL.md「🌊 组建 Agent 军团」第一步，在 OpenClaw 中为此成员完成创建（workspace + agents.list + SOUL.md + LLM auth），` +
      `使其从"纸面成员"变为可执行任务的真正 Agent。`

    const notifyMsg = await prisma.chatMessage.create({
      data: {
        content: notifyContent,
        role: 'user',
        userId: user.id,
        metadata: JSON.stringify({ source: 'system', subAgentId: result.subAgent.id }),
      }
    })
    // 创建 pending 占位等主 Agent 回复
    const agentReplyMsg = await prisma.chatMessage.create({
      data: {
        content: '__pending__',
        role: 'agent',
        userId: user.id,
        agentId: user.agent!.id,
      }
    })
    sendToUser(user.id, {
      type: 'chat:incoming',
      msgId: agentReplyMsg.id,
      content: notifyContent,
      agentId: user.agent!.id,
    } as any)
    console.log(`[CreateSub] ✅ 已通知主 Agent (${user.agent!.name}) 创建 OpenClaw 子 Agent: ${name.trim()}`)

    return NextResponse.json({
      success: true,
      message: `🎉 ${name.trim()} 已创建成功！`,
      agent: {
        id: result.subAgent.id,
        name: result.subAgent.name,
        personality: result.subAgent.personality,
        capabilities,
        status: 'offline',
      },
      token: rawToken,  // 首次返回，用于 Agent 连接
    }, { status: 201 })
  } catch (error) {
    console.error('[CreateSub] 创建子 Agent 失败:', error)
    return NextResponse.json({ error: '创建失败' }, { status: 500 })
  }
}
