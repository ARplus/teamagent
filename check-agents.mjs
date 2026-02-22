import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const agents = await prisma.agent.findMany({
  select: { id: true, name: true, userId: true, pairingCode: true, pairingCodeExpiresAt: true, status: true, isMainAgent: true }
})
console.log(JSON.stringify(agents, null, 2))

await prisma.$disconnect()
