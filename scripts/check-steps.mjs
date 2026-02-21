import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const task = await prisma.task.findFirst({
  where: { title: { contains: '构建论文' } },
  include: {
    steps: {
      include: {
        assignee: { select: { id: true, name: true } }
      },
      orderBy: { order: 'asc' }
    }
  }
})

if (task) {
  console.log(`Task: ${task.title}`)
  for (const s of task.steps) {
    const name = s.assignee?.name || '未分配'
    console.log(`  Step ${s.order}: [${s.status}] → ${name} | "${s.title}"`)
  }
} else {
  console.log('Task not found')
}

await prisma.$disconnect()
