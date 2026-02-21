import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const step = await prisma.taskStep.findUnique({
  where: { id: 'cmlwgdgn0000di9y8krljzpau' },
  select: { id: true, title: true, status: true, rejectionReason: true, rejectionCount: true }
})
console.log(JSON.stringify(step, null, 2))
await prisma.$disconnect()
