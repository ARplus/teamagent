const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const agents = await p.agent.findMany({
    include: { user: { select: { name: true, email: true } } }
  });
  console.log('All agents:');
  agents.forEach(a => {
    console.log(` - ${a.name} | isMainAgent: ${a.isMainAgent} | user: ${a.user?.name || a.user?.email || 'none'} | id: ${a.id}`);
  });
  
  const main = agents.filter(a => a.isMainAgent);
  console.log('\nMain agents:', main.length);
  if (main.length === 0) console.log('⚠️  No main agent found! Need to set isMainAgent=true for Lobster.');
}
main().catch(console.error).finally(() => p.$disconnect());
