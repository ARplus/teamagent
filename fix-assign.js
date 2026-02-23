const { PrismaClient } = require('.prisma/client')
const db = new PrismaClient()
// Team模式测试任务拆解 → 木须/八爪
db.taskStep.update({
  where: { id: 'cmly4virw000jv7agar7we4k2' },
  data: { assigneeId: 'cmly2cr2u0000v7scf41lsrzg' }
}).then(r => {
  console.log('✅ Team模式测试任务拆解 → 八爪')
  db.$disconnect()
}).catch(console.error)
