const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'aurora@arplus.top' },
    select: { id: true, name: true }
  });
  console.log('User:', user);

  const members = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: { role: true, workspaceId: true }
  });
  console.log('Memberships:', members);

  // Check if there are any invites
  const invites = await prisma.inviteToken.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, token: true, inviterId: true, usedAt: true, expiresAt: true, createdAt: true }
  });
  console.log('All recent invites:', invites);

  // Check if 'cmltpejxl0019i98orggjld23' is a task ID
  const task = await prisma.task.findUnique({
    where: { id: 'cmltpejxl0019i98orggjld23' },
    select: { id: true, title: true }
  });
  console.log('Is it a task ID?', task);
}

main().finally(() => prisma.$disconnect());
