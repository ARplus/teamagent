// 查询所有 Agent，找到 Lobster，设置 isMainAgent=true
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const agents = await p.agent.findMany({
    include: { user: { select: { name: true, email: true } } }
  });
  console.log('All agents:');
  agents.forEach(a => {
    console.log(` - [${a.isMainAgent ? 'MAIN' : '    '}] ${a.name} | id: ${a.id} | user: ${a.user?.name || a.user?.email || 'no user'}`);
  });

  // 找 Lobster（name 包含 Lobster 或 lobster）
  const lobster = agents.find(a => a.name?.toLowerCase().includes('lobster'));
  if (!lobster) {
    console.log('\n⚠️  Lobster not found! Agents list above.');
    return;
  }

  if (lobster.isMainAgent) {
    console.log(`\n✅ ${lobster.name} already isMainAgent=true`);
    return;
  }

  // 设置为主Agent
  await p.agent.update({
    where: { id: lobster.id },
    data: { isMainAgent: true }
  });
  console.log(`\n✅ Set ${lobster.name} (${lobster.id}) as main agent!`);
}
main().catch(console.error).finally(() => p.$disconnect());
