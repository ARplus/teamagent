const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
p.task.findFirst({
  where: { title: { contains: 'AI' } },
  orderBy: { createdAt: 'desc' },
  include: { steps: { orderBy: { order: 'asc' } }, creator: { select: { name: true } } }
}).then(t => {
  if (!t) return console.log('not found');
  console.log('Task:', t.title);
  console.log('Mode:', t.mode);
  console.log('Creator:', t.creator?.name);
  console.log('Description:', t.description || '(empty)');
  console.log('Steps:', t.steps.length);
  t.steps.forEach(s => console.log(' ', s.order, '['+s.status+']', s.stepType, s.title));
}).catch(console.error).finally(() => p.$disconnect());
