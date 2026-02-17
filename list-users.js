const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const users = await p.user.findMany({
    include: { apiTokens: true }
  })
  
  for (const u of users) {
    console.log(`\n用户: ${u.name} (${u.nickname || '无昵称'})`)
    console.log(`  ID: ${u.id}`)
    console.log(`  Email: ${u.email}`)
    if (u.apiTokens.length > 0) {
      for (const t of u.apiTokens) {
        console.log(`  Token: ${t.token}`)
      }
    }
  }
}

main().finally(() => p.$disconnect())
