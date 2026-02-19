const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

p.task.findMany({
  include: {
    steps: {
      orderBy: { order: 'asc' },
      include: { assignee: { select: { id: true, name: true } } }
    },
    creator: { select: { name: true, email: true } }
  },
  orderBy: { createdAt: 'desc' }
}).then(tasks => {
  tasks.forEach(t => {
    console.log(`\n[Task] ${t.id}`)
    console.log(`  标题: ${t.title}`)
    console.log(`  创建者: ${t.creator?.name} (${t.creator?.email})`)
    console.log(`  状态: ${t.status}`)
    t.steps.forEach(s => {
      const who = s.assignee ? `${s.assignee.name}(${s.assignee.id.slice(-6)})` : '(未分配/可领取)'
      console.log(`  步骤${s.order}: ${s.title}`)
      console.log(`         状态: ${s.status} | 负责: ${who} | ID: ${s.id}`)
    })
  })
}).catch(e => console.error(e.message)).finally(() => p.$disconnect())
