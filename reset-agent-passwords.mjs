import { PrismaClient } from './node_modules/.prisma/client/index.js'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const newPassword = 'lobster-agent-2026'
const hash = await bcrypt.hash(newPassword, 10)

const emails = [
  'quill@lobster.ai',
  'testrunner@lobster.ai', 
  'codereviewer@lobster.ai',
  'devops@lobster.ai'
]

for (const email of emails) {
  await prisma.user.update({
    where: { email },
    data: { password: hash }
  })
  console.log(`✅ 重置密码: ${email}`)
}

console.log(`\n密码统一改为: ${newPassword}`)
await prisma.$disconnect()
