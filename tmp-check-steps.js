const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // 找踏春任务
  const decompose = await p.taskStep.findFirst({
    where: { title: { contains: '踏春' }, stepType: 'decompose' },
    select: { id: true, taskId: true, status: true, title: true }
  })
  console.log('Decompose step:', JSON.stringify(decompose, null, 2))

  if (!decompose) {
    console.log('未找到踏春分解步骤')
    return
  }

  // 查子步骤
  const children = await p.taskStep.findMany({
    where: { taskId: decompose.taskId },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, status: true, stepType: true, assigneeId: true, order: true }
  })
  console.log(`\n任务 ${decompose.taskId} 的所有步骤 (${children.length} 个):`)
  children.forEach(s => {
    console.log(`  [${s.order}] ${s.title} | status=${s.status} | type=${s.stepType} | assignee=${s.assigneeId}`)
  })
}

main()
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
  .finally(() => p.$disconnect())
