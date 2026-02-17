const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // 找到旧的测试任务
  const oldTasks = await p.task.findMany({
    where: {
      title: { contains: '愚人节游戏' }
    }
  })
  
  console.log('找到的旧任务:')
  for (const t of oldTasks) {
    console.log(`  - ${t.title} (${t.id})`)
  }
  
  if (oldTasks.length > 0) {
    // 删除
    for (const t of oldTasks) {
      await p.task.delete({ where: { id: t.id } })
      console.log(`已删除: ${t.title}`)
    }
  }
}

main().finally(() => p.$disconnect())
