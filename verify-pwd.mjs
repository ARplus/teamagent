import { PrismaClient } from './node_modules/.prisma/client/index.js'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const user = await prisma.user.findUnique({ 
  where: { email: 'quill@lobster.ai' },
  select: { password: true }
})
console.log('hash in DB:', user?.password?.substring(0, 30) + '...')
const ok = await bcrypt.compare('lobster-agent-2026', user.password)
console.log('password match:', ok)
await prisma.$disconnect()
