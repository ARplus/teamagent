import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// 找所有 Internal 开头的任务
const tasks = await prisma.task.findMany({
  where: { title: { startsWith: 'Internal' } },
  include: {
    steps: {
      select: { id: true, title: true, status: true, assigneeId: true, order: true },
      orderBy: { order: 'asc' }
    }
  }
})

for (const task of tasks) {
  console.log(`\n=== ${task.title} (${task.id}) ===`)
  for (const s of task.steps) {
    console.log(`  Step ${s.order}: "${s.title}" | status=${s.status} | assigneeId=${s.assigneeId || 'NULL'}`)
  }
}

await prisma.$disconnect()
