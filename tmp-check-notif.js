const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
p.notification.findMany({
  orderBy: { createdAt: 'desc' },
  take: 15,
  select: { userId: true, title: true, type: true, read: true, createdAt: true }
}).then(r => {
  console.log(JSON.stringify(r, null, 2))
  p.$disconnect()
}).catch(e => { console.error(e); p.$disconnect() })
