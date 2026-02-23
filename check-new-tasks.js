const {PrismaClient} = require('./node_modules/@prisma/client')
const p = new PrismaClient()
async function main() {
  const ids = ['s6y5ari8', '5jtj5wuc', 'bo7i3qvm', 'upjj1bph', 'h00cyy1o']
  
  for (const shortId of ids) {
    const task = await p.task.findFirst({
      where: { id: { endsWith: shortId } },
      include: {
        creator: { select: { name: true } },
        steps: {
          include: { assignee: { select: { id: true, name: true } } },
          orderBy: { order: 'asc' }
        }
      }
    })
    if (!task) { console.log(`[${shortId}] not found`); continue }
    console.log(`\n=== [${task.id}] ${task.title} ===`)
    console.log(`创建者: ${task.creator?.name} | 模式: ${task.mode}`)
    task.steps.forEach((s, i) => {
      console.log(`  ${i+1}. [${s.status}] ${s.title.slice(0,50)}`)
      console.log(`     assignee: ${s.assignee?.name || '未分配'} | requiresApproval: ${s.requiresApproval}`)
      if (s.description) console.log(`     desc: ${s.description.slice(0,100)}`)
    })
  }
}
main().catch(console.error).finally(() => p.$disconnect())
