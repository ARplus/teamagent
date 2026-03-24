const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const prisma = new PrismaClient()

function generateToken() {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex')
}

async function main() {
  // 1. 检查是否已存在
  const existing = await prisma.user.findUnique({ where: { email: 'kaikai@arplus.top' } })
  if (existing) {
    console.log('已存在，跳过创建')
    // 查看现有信息
    const agent = await prisma.agent.findUnique({ where: { userId: existing.id } })
    const tokens = await prisma.apiToken.findMany({ where: { userId: existing.id } })
    console.log('userId:', existing.id)
    console.log('agentId:', agent?.id)
    console.log('tokens:', tokens.length)
    return
  }

  // 2. 找到木须的工作区
  const muxu = await prisma.user.findFirst({ where: { email: 'muxu@arplus.top' } })
  if (!muxu) { console.log('找不到木须'); return }

  const wsMember = await prisma.workspaceMember.findFirst({
    where: { userId: muxu.id },
    include: { workspace: true }
  })
  if (!wsMember) { console.log('找不到工作区'); return }

  console.log('工作区:', wsMember.workspace.name)

  // 3. 创建凯凯用户 + Agent + Token
  const hashedPwd = await bcrypt.hash('kaikai-dev-2026', 10)
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: 'kaikai@arplus.top',
        password: hashedPwd,
        name: '凯凯',
        avatar: '🤖',
      }
    })

    const agent = await tx.agent.create({
      data: {
        name: '凯凯',
        userId: user.id,
        status: 'online',
        capabilities: JSON.stringify(['全栈开发', '系统架构', 'Bug修复', '部署运维']),
        personality: 'TeamAgent 平台开发者，负责搭建和维护整个 Gaia 协作系统。',
        isMainAgent: false,
        claimedAt: new Date(),
        onboardingStatus: 'graduated',
      }
    })

    await tx.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: wsMember.workspace.id,
        role: 'admin',
        memberSource: 'manual',
        addedByUserId: muxu.id,
      }
    })

    await tx.apiToken.create({
      data: {
        token: hashedToken,
        name: '凯凯-主Token',
        userId: user.id,
      }
    })

    return { user, agent }
  })

  console.log('=== 凯凯注册成功 ===')
  console.log('userId:', result.user.id)
  console.log('agentId:', result.agent.id)
  console.log('email: kaikai@arplus.top')
  console.log('password: kaikai-dev-2026')
  console.log('token:', rawToken)
  console.log('工作区:', wsMember.workspace.name, '(admin)')
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
