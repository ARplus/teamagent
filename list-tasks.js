const {PrismaClient} = require('./node_modules/@prisma/client')
const p = new PrismaClient()
async function main() {
  // 八爪的 userId
  const bazhua = await p.user.findFirst({ where: { name: { contains: '八爪' } } })
  console.log('八爪 userId:', bazhua?.id)
  
  // 最近的任务（木须工作区 + Aurora 工作区）
  const tasks = await p.task.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      creator: { select: { name: true } },
      workspace: { select: { name: true } },
      steps: { select: { id: true, title: true, status: true, assigneeId: true }, orderBy: { order: 'asc' } }
    }
  })
  tasks.forEach(t => {
    const pending = t.steps.filter(s => ['pending','waiting_approval'].includes(s.status)).length
    console.log(`\n[${t.id.slice(-8)}] ${t.title.slice(0,50)}`)
    console.log(`  创建者: ${t.creator?.name} | 工作区: ${t.workspace?.name} | ${t.status} | ${t.steps.length}步 ${pending}待`)
    if (t.steps.length > 0) {
      t.steps.slice(0,5).forEach(s => console.log(`    - [${s.status}] ${s.title.slice(0,40)}`))
      if (t.steps.length > 5) console.log(`    ... +${t.steps.length-5}步`)
    }
  })
}
main().catch(console.error).finally(() => p.$disconnect())
