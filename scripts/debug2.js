const { PrismaClient } = require('../node_modules/@prisma/client');
const p = new PrismaClient();

async function main() {
  const tasks = await p.task.findMany({
    where: { creatorId: 'cmltlopxp0001i9ywj4oged86' },
    select: { id: true, title: true }
  });
  console.log('Aurora created tasks:');
  tasks.forEach(t => console.log(' -', t.id, t.title));

  const fannaTask = await p.task.findUnique({
    where: { id: 'cmltpejxl0019i98orggjld23' },
    select: { id: true, title: true, creator: { select: { email: true, name: true } } }
  });
  console.log('\n"只给范娜" task creator:', fannaTask?.creator);
}

main().finally(() => p.$disconnect());
