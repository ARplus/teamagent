const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
prisma.task.findMany({ include: { steps: { orderBy: { order: 'asc' } } } }).then(tasks => {
  tasks.forEach(t => {
    console.log('\nTask:', t.title, '| mode:', t.mode, '| status:', t.status);
    t.steps.forEach(s => console.log('  Step', s.order, '['+s.status+']', s.title.substring(0, 50)));
  });
  console.log('\nTotal tasks:', tasks.length);
}).catch(console.error).finally(() => prisma.$disconnect());
