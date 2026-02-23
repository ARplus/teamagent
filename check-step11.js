// 查 step 11 的 assigneeId
const {PrismaClient} = require('./node_modules/@prisma/client')
const p = new PrismaClient()

async function main() {
  // 找"新建步骤缺少引导"步骤
  const step = await p.taskStep.findFirst({
    where: { title: { contains: '新建步骤缺少引导' } },
    include: { assignee: { select: { id: true, name: true, email: true } } }
  })
  console.log('step.id:', step?.id)
  console.log('step.title:', step?.title)
  console.log('step.status:', step?.status)
  console.log('step.assigneeId:', step?.assigneeId)
  console.log('step.assignee:', JSON.stringify(step?.assignee, null, 2))

  // Aurora 的 userId
  const aurora = await p.user.findFirst({ where: { email: 'aurora@arplus.top' } })
  console.log('\nAurora userId:', aurora?.id)
  console.log('Match:', step?.assigneeId === aurora?.id)
}

main().catch(console.error).finally(() => p.$disconnect())
