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
  const userId = 'cmlq8qw7a0004i950cyjmtee2' // 段段
  
  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)
  
  await p.apiToken.deleteMany({ where: { userId } })
  
  await p.apiToken.create({
    data: {
      token: hashedToken,
      name: '段段-Agent',
      userId
    }
  })
  
  console.log('=== 段段的 API Token ===')
  console.log(rawToken)
}

main().finally(() => p.$disconnect())
