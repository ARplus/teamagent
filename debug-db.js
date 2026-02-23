const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Check Lobster agent
  const lobster = await prisma.agent.findFirst({ where: { name: 'Lobster' }, select: { id: true, name: true, userId: true, isMainAgent: true } })
  console.log('Lobster agent:', JSON.stringify(lobster))

  // Check Aurora user
  const aurora = await prisma.user.findFirst({ where: { email: 'aurora@arplus.top' }, select: { id: true, name: true, email: true } })
  console.log('Aurora user:', JSON.stringify(aurora))

  // Check waiting_approval steps and their agents
  const steps = await prisma.taskStep.findMany({
    where: { status: 'waiting_approval' },
    select: { id: true, title: true, assigneeId: true, status: true, agent: { select: { id: true, name: true, userId: true } } },
    take: 5
  })
  console.log('Waiting approval steps:', JSON.stringify(steps, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
