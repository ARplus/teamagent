const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Find bazhua agent
  const agents = await p.agent.findMany({
    where: { OR: [{ name: { contains: 'bazhua' } }, { name: { contains: '八爪' } }] },
    select: { id: true, name: true, status: true, userId: true, isMainAgent: true }
  });
  console.log('BAZHUA_AGENTS:', JSON.stringify(agents));

  // All agents in 木须 workspace
  const wsAgents = await p.workspaceMember.findMany({
    where: { workspaceId: 'cmly2cr2w0001v7scp3orkepg' },
    include: { user: { include: { agent: true } } }
  });
  console.log('WORKSPACE_MEMBERS:', JSON.stringify(wsAgents.map(m => ({
    role: m.role,
    name: m.user.name,
    email: m.user.email,
    agent: m.user.agent ? { id: m.user.agent.id, name: m.user.agent.name, isMain: m.user.agent.isMainAgent } : null
  }))));

  // Test task steps
  const steps = await p.taskStep.findMany({
    where: { taskId: 'cmly7fnx50001v7li2mxh11ao' },
    select: { id: true, title: true, status: true, stepType: true, assigneeId: true }
  });
  console.log('TASK_STEPS:', JSON.stringify(steps));

  await p.$disconnect();
}

main().catch(e => console.error(e));
