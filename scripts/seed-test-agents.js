/**
 * seed-test-agents.js
 * 创建3个测试用户+Agent+Token，用于"国际微生态健康治理智库"测试
 * 跳过人工配对流程，直接写库
 *
 * 用法：node scripts/seed-test-agents.js
 */

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

const TEST_AGENTS = [
  {
    email: 'bijianlong@test.ai',
    password: 'test1234',
    name: '毕见龙',
    agentName: '毕见龙 · Life Architect',
    agentPersona: '北大医疗康复医院 重症康复科/微生态中心 主任，医学背景，擅长临床研究与多学科协作',
    workspaceName: '北大医疗康复医院'
  },
  {
    email: 'fannanana@test.ai',
    password: 'test1234',
    name: '范娜',
    agentName: '范娜 · Nana',
    agentPersona: '微生态产品代理商，擅长市场分析、产品落地与渠道合作',
    workspaceName: '微生态产品事业部'
  },
  {
    email: 'vivian@test.ai',
    password: 'test1234',
    name: '张伟 Vivian',
    agentName: '张伟 · Vivian',
    agentPersona: '北京工商大学教授，留法背景，擅长学术研究、政策分析与国际合作',
    workspaceName: '北京工商大学研究中心'
  }
]

function generateToken() {
  return 'ta_' + crypto.randomBytes(32).toString('hex')
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateId() {
  // cuid-like
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

async function main() {
  console.log('🌱 创建测试 Agent 账号...\n')

  const results = []

  for (const agent of TEST_AGENTS) {
    // 检查是否已存在
    const existing = await prisma.user.findUnique({ where: { email: agent.email } })
    if (existing) {
      // 检查 Agent 是否已建
      const existingAgent = await prisma.agent.findFirst({ where: { userId: existing.id } })
      const existingToken = await prisma.apiToken.findFirst({ where: { userId: existing.id } })

      if (existingAgent && existingToken) {
        console.log(`⏭️  ${agent.name} (${agent.email}) 已完整存在，跳过`)
        results.push({ name: agent.name, agentName: existingAgent.name, token: existingToken.token, agentId: existingAgent.id, email: agent.email })
        continue
      }

      // 用户存在但 Agent/Token 缺失——补建
      console.log(`🔧 ${agent.name} 用户已存在，补建 Agent + Token...`)
      const tok = generateToken()

      let ag = existingAgent
      if (!ag) {
        ag = await prisma.agent.create({
          data: {
            name: agent.agentName,
            personality: agent.agentPersona,
            user: { connect: { id: existing.id } },
            status: 'online',
            claimedAt: new Date(),
            pendingApiToken: null
          }
        })
      }
      if (!existingToken) {
        await prisma.apiToken.create({
          data: { token: hashToken(tok), name: `${agent.agentName} Skill Token`, userId: existing.id }
        })
      }
      const finalToken = existingToken ? existingToken.token : tok
      console.log(`✅ ${agent.name} - Token: ${finalToken}\n`)
      results.push({ name: agent.name, agentName: ag.name, token: finalToken, agentId: ag.id, email: agent.email })
      continue
    }

    const hashedPassword = await bcrypt.hash(agent.password, 10)
    const apiToken = generateToken()

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email: agent.email,
        password: hashedPassword,
        name: agent.name,
      }
    })

    // 创建默认工作区
    await prisma.workspace.create({
      data: {
        name: agent.workspaceName,
        members: {
          create: { userId: user.id, role: 'owner' }
        }
      }
    })

    // 创建 Agent（已配对状态）
    const newAgent = await prisma.agent.create({
      data: {
        name: agent.agentName,
        personality: agent.agentPersona,
        user: { connect: { id: user.id } },
        status: 'online',
        claimedAt: new Date(),
        pendingApiToken: null
      }
    })

    // 创建 ApiToken（关联到 User，供 teamagent-client.js 使用）
    await prisma.apiToken.create({
      data: {
        token: apiToken,
        name: `${agent.agentName} Skill Token`,
        userId: user.id
      }
    })

    console.log(`✅ ${agent.name}`)
    console.log(`   邮箱:  ${agent.email}`)
    console.log(`   Agent: ${agent.agentName}`)
    console.log(`   Token: ${apiToken}`)
    console.log(`   ID:    ${newAgent.id}\n`)

    results.push({ name: agent.name, agentName: agent.agentName, token: apiToken, agentId: newAgent.id, email: agent.email })
  }

  // 输出汇总（JSON 供后续使用）
  console.log('\n📋 汇总（复制给子智能体用）:')
  console.log(JSON.stringify(results, null, 2))

  // 写入配置文件
  const fs = require('fs')
  const configPath = './scripts/test-agents-config.json'
  fs.writeFileSync(configPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`\n💾 已保存到 ${configPath}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
