const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const tasks = await p.task.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      steps: {
        include: { assignee: { select: { id: true, name: true, nickname: true } } },
        orderBy: { order: 'asc' }
      },
      creator: { select: { name: true } }
    }
  })
  
  for (const t of tasks) {
    console.log(`\n任务: ${t.title} (${t.id})`)
    console.log(`  创建者: ${t.creator?.name}`)
    console.log(`  状态: ${t.status}`)
    console.log(`  步骤:`)
    for (const s of t.steps) {
      console.log(`    - [${s.status}] ${s.title}`)
      console.log(`      负责人: ${s.assignee?.nickname || s.assignee?.name || s.assigneeNames || '无'}`)
      console.log(`      步骤ID: ${s.id}`)
    }
  }
}

main().finally(() => p.$disconnect())
