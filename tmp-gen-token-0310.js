const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'muxu@arplus.top' } })
  if (!user) { console.log('USER_NOT_FOUND'); return }
  await prisma.apiToken.create({
    data: {
      token: '08def1f641b107a8b7a6410b71fe50b09980d215b92aa424c8b035a0c2bef616',
      displayToken: 'ta_7ca4...58dde',
      name: '新PC安装-0310',
      userId: user.id,
    }
  })
  console.log('TOKEN_CREATED')
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
