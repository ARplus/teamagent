const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const user = await p.user.findFirst({
    where: { nickname: '小敏' },
    include: { apiTokens: true }
  })
  
  if (user) {
    console.log('用户:', user.name, '(', user.nickname, ')')
    console.log('用户ID:', user.id)
    for (const t of user.apiTokens) {
      console.log('Token:', t.token)
    }
  } else {
    console.log('找不到小敏')
  }
}

main().finally(() => p.$disconnect())
