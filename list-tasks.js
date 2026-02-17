const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const tasks = await p.task.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      steps: { orderBy: { order: 'asc' } }
    }
  })
  
  for (const task of tasks) {
    console.log('\n=== ' + task.title + ' ===')
    console.log('ID:', task.id)
    console.log('Created:', task.createdAt.toLocaleString('zh-CN'))
    console.log('Steps:', task.steps.length)
    
    for (const s of task.steps) {
      const assigned = s.assigneeId ? '' : ' (未分配)'
      console.log(`  ${s.order}. ${s.title} — ${s.status}${assigned}`)
    }
  }
}

main().finally(() => p.$disconnect())
