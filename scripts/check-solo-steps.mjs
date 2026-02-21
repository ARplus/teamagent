import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const task = await prisma.task.findFirst({
  where: { title: { contains: 'Solo功能验证' } },
  include: { steps: { orderBy: { order: 'asc' }, include: { assignee: true } } }
})

console.log('Task:', task.title, '| Status:', task.status)
for (const s of task.steps) {
  console.log(`\n--- Step ${s.order} [${s.status}] ${s.title} ---`)
  console.log('ID:', s.id)
  console.log('Assignee:', s.assignee?.name || 'none')
  console.log('CompletedAt:', s.completedAt)
  console.log('Result (500 chars):', s.result ? s.result.substring(0, 500) : '(empty)')
}

// Also check Solo mode dev task  
const task2 = await prisma.task.findFirst({
  where: { title: { contains: 'Solo mode模块开发' } },
  include: { steps: { orderBy: { order: 'asc' }, include: { assignee: true } } }
})
console.log('\n\n=== Solo mode模块开发 ===')
for (const s of task2.steps) {
  console.log(`Step ${s.order} [${s.status}] ${s.title}`)
}

await prisma.$disconnect()
