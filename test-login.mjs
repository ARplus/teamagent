// 测试 NextAuth credentials login
const res = await fetch('http://localhost:3000/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    email: 'quill@lobster.ai',
    password: 'lobster-agent-2026',
    csrfToken: 'test',
    callbackUrl: 'http://localhost:3000',
    json: 'true'
  }),
  redirect: 'manual'
})
console.log('status:', res.status)
console.log('location:', res.headers.get('location'))

// Also test the authorize function directly
import { PrismaClient } from './node_modules/.prisma/client/index.js'
import bcrypt from 'bcryptjs'
const prisma = new PrismaClient()
const user = await prisma.user.findUnique({ where: { email: 'quill@lobster.ai' } })
console.log('\nUser found:', user ? 'yes' : 'no')
console.log('Password field exists:', !!user?.password)
const match = user ? await bcrypt.compare('lobster-agent-2026', user.password) : false
console.log('Password matches:', match)
await prisma.$disconnect()
