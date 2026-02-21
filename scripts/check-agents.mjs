import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const agents = await prisma.agent.findMany({
  select: { id: true, name: true, status: true, userId: true }
})
console.log('All agents:', JSON.stringify(agents, null, 2))

// 模拟 /api/agents 过滤逻辑
const filtered = agents.filter(a => a.status !== 'offline' && a.userId !== null)
console.log('\nFiltered (non-offline + has userId):', filtered.length, 'agents')

await prisma.$disconnect()
