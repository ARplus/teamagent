import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// 生成6位数字配对码
const code = String(Math.floor(100000 + Math.random() * 900000))
// 有效期 48 小时
const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

const agent = await prisma.agent.create({
  data: {
    name: 'Quill🦑',
    status: 'online',
    pairingCode: code,
    pairingCodeExpiresAt: expiresAt,
  }
})

console.log('=== 新 Agent 配对码 ===')
console.log('名字:', agent.name)
console.log('配对码:', code)
console.log('有效至:', expiresAt.toLocaleString('zh-CN'))
console.log('Agent ID:', agent.id)

await prisma.$disconnect()
