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
  const userId = 'cmlq8p3f50002i950h6lkg02l' // 小敏
  
  // 生成新 token
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)
  
  // 删除旧 token 并创建新的
  await p.apiToken.deleteMany({ where: { userId } })
  
  await p.apiToken.create({
    data: {
      token: hashedToken,
      name: '小敏-Agent',
      userId
    }
  })
  
  console.log('=== 小敏的新 API Token ===')
  console.log('用这个调用 API:', rawToken)
  console.log('存到数据库的 hash:', hashedToken)
}

main().finally(() => p.$disconnect())
