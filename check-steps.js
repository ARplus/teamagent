const { PrismaClient } = require('.prisma/client')
const db = new PrismaClient()
db.taskStep.findMany({
  where: { taskId: 'cmly4tose000dv7aga1slxil9' },
  select: { id: true, title: true, assigneeId: true, assignee: { select: { name: true, agent: { select: { name: true } } } } }
}).then(r => {
  r.forEach(s => console.log(`${s.title} -> user:${s.assignee?.name || 'null'} agent:${s.assignee?.agent?.name || 'null'}`))
  db.$disconnect()
}).catch(console.error)
