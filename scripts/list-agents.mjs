import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const agents = await prisma.agent.findMany({
  where: { userId: { not: null } },
  include: { user: { select: { id: true, name: true, email: true } } },
  orderBy: { createdAt: 'asc' }
})
console.log('注册 Agent 列表:')
agents.forEach(a => console.log(' -', a.name, '|', a.user?.email, '| userId:', a.userId?.slice(0,12), '| status:', a.status))
await prisma.$disconnect()
