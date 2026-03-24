const { PrismaClient } = require('./node_modules/@prisma/client')
const p = new PrismaClient()
p.agent.findMany({
  where: { parentAgentId: { not: null } },
  select: { id: true, name: true, userId: true, parentAgentId: true }
}).then(r => {
  console.log(JSON.stringify(r, null, 2))
  return p.$disconnect()
}).catch(e => { console.error(e); process.exit(1) })
