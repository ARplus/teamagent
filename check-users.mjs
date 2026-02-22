import { PrismaClient } from './node_modules/.prisma/client/index.js'
const prisma = new PrismaClient()
const users = await prisma.user.findMany({ 
  select: { id: true, email: true, name: true, nickname: true }
})
console.log(JSON.stringify(users, null, 2))
await prisma.$disconnect()
