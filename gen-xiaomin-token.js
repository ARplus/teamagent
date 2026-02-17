const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

const p = new PrismaClient()

function generateToken() {
  return `ta_${crypto.randomBytes(32).toString('hex')}`
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function main() {
  // 找到小敏
  const user = await p.user.findFirst({
    where: { email: 'xiaomin@arplus.top' }
  })
  
  if (!user) {
    console.log('找不到小敏')
    return
  }
  
  // 生成新 token
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)
  
  // 删除旧 token，创建新的
  await p.apiToken.deleteMany({ where: { userId: user.id } })
  
  await p.apiToken.create({
    data: {
      token: hashedToken,
      name: '小敏 Skill Token',
      userId: user.id
    }
  })
  
  console.log('✅ 小敏的新 Token (保存好！):')
  console.log(rawToken)
}

main().finally(() => p.$disconnect())
