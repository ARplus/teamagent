const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  // 找任务
  const task = await p.task.findFirst({ where: { title: { contains: '中医' } } });
  console.log('Task ID:', task?.id, '| WorkspaceId:', task?.workspaceId);
  
  // 找工作区成员和 Agent 能力
  const members = await p.workspaceMember.findMany({
    where: { workspaceId: task?.workspaceId },
    include: {
      user: {
        include: { agent: { select: { id: true, name: true, capabilities: true, isMainAgent: true, status: true } } }
      }
    }
  });
  console.log('\nTeam members:');
  members.forEach(m => {
    const a = m.user.agent;
    console.log(' -', m.user.name, '|', a ? `Agent: ${a.name} (main:${a.isMainAgent}, status:${a.status})` : 'no agent');
    if (a?.capabilities) console.log('   capabilities:', a.capabilities);
  });
}
main().catch(console.error).finally(() => p.$disconnect());
