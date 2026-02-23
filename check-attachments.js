const {PrismaClient} = require('./node_modules/@prisma/client')
const p = new PrismaClient()
async function main() {
  // 中国安装指南任务的附件
  const task = await p.task.findFirst({
    where: { id: { endsWith: 's6y5ari8' } },
    include: {
      attachments: true,
      steps: { include: { attachments: true }, orderBy: { order: 'asc' } }
    }
  })
  console.log('任务附件:', JSON.stringify(task?.attachments, null, 2))
  task?.steps.forEach(s => {
    if (s.attachments.length > 0) console.log(`步骤"${s.title}"附件:`, JSON.stringify(s.attachments, null, 2))
  })
  
  // Best Practices 文档任务
  const bp = await p.task.findFirst({
    where: { id: { endsWith: 'h00cyy1o' } },
    include: { attachments: true }
  })
  console.log('\nBest Practices 附件:', JSON.stringify(bp?.attachments, null, 2))
  console.log('Best Practices 描述:', bp?.description?.slice(0, 500))
}
main().catch(console.error).finally(() => p.$disconnect())
