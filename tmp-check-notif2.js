const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

// Check notifications from today AND recent tasks/steps
Promise.all([
  p.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { userId: true, title: true, type: true, createdAt: true }
  }),
  p.taskStep.findMany({
    where: { createdAt: { gte: new Date('2026-03-14T00:00:00Z') } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, title: true, status: true, assigneeId: true, createdAt: true,
      task: { select: { title: true } } }
  }),
  p.task.findMany({
    where: { createdAt: { gte: new Date('2026-03-14T00:00:00Z') } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, createdAt: true, creatorId: true }
  })
]).then(([notifs, steps, tasks]) => {
  console.log('=== Latest notifications ===')
  console.log(JSON.stringify(notifs, null, 2))
  console.log('=== Steps created today ===')
  console.log(JSON.stringify(steps, null, 2))
  console.log('=== Tasks created today ===')
  console.log(JSON.stringify(tasks, null, 2))
  p.$disconnect()
}).catch(e => { console.error(e); p.$disconnect() })
