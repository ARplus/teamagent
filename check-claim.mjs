import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
const prisma = new PrismaClient()

const rawToken = 'ta_03a4cbfe45ed327cfd3ac8f4fd3e02605b9ea9e0350efca47403f625e7454cfe'
const hashed = crypto.createHash('sha256').update(rawToken).digest('hex')

const apiToken = await prisma.apiToken.findFirst({
  where: { token: hashed },
  include: { user: { include: { agent: true } } }
})

if (apiToken) {
  console.log('✅ Token 有效！')
  console.log('用户:', apiToken.user.email)
  console.log('Agent:', apiToken.user.agent?.name, '| id:', apiToken.user.agent?.id)
  console.log('isMainAgent:', apiToken.user.agent?.isMainAgent)
} else {
  console.log('❌ Token 未找到')
}

await prisma.$disconnect()
