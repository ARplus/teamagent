const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

Promise.all([
  p.user.findMany({
    select: { id: true, name: true, nickname: true, email: true,
      agent: { select: { id: true, name: true, isMainAgent: true } } }
  }),
  // Check recent steps with assignee info
  p.taskStep.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, status: true, assigneeId: true, createdAt: true,
      assignees: { select: { userId: true, assigneeType: true } },
      task: { select: { title: true } } }
  })
]).then(([users, steps]) => {
  console.log('=== Users ===')
  console.log(JSON.stringify(users, null, 2))
  console.log('=== Recent steps (with assignees) ===')
  console.log(JSON.stringify(steps, null, 2))
  p.$disconnect()
}).catch(e => { console.error(e); p.$disconnect() })
