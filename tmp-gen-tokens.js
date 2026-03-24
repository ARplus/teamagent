// 临时脚本：为测试生成几个 API Token
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

const prisma = new PrismaClient()

function generateToken() {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function main() {
  // 找到木须的账号
  const user = await prisma.user.findFirst({
    where: { email: 'muxu@arplus.top' }
  })
  if (!user) {
    console.log('用户不存在')
    return
  }

  console.log(`为用户 ${user.name} (${user.email}) 生成测试 token:\n`)

  const tokens = []
  for (let i = 1; i <= 5; i++) {
    const raw = generateToken()
    const hashed = hashToken(raw)
    await prisma.apiToken.create({
      data: {
        token: hashed,
        displayToken: raw,
        name: `测试token-${i}`,
        userId: user.id,
      }
    })
    tokens.push(raw)
    console.log(`Token ${i}: ${raw}`)
  }

  console.log(`\n共生成 ${tokens.length} 个 token，可用于安装测试`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
