import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const task = await prisma.task.findFirst({
  where: { title: { contains: 'Solo功能验证' } },
  include: { steps: { orderBy: { order: 'asc' }, include: { assignee: true } } }
})

console.log('Task ID:', task.id)
for (const s of task.steps) {
  console.log(`Step ${s.order} [${s.status}] ID:${s.id} | ${s.title} → ${s.assignee?.name || 'unassigned'}`)
}

await prisma.$disconnect()
