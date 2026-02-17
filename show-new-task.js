const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const task = await p.task.findUnique({
    where: { id: 'cmlqdxgwy0001i9ak8u49f21a' },
    include: {
      steps: {
        orderBy: { order: 'asc' },
        include: {
          assignee: { select: { name: true } }
        }
      }
    }
  })
  
  console.log('任务:', task.title)
  console.log('描述:', task.description?.substring(0, 100) + '...')
  console.log('\n步骤分配:')
  
  for (const s of task.steps) {
    const assignee = s.assignee?.name || JSON.parse(s.assigneeNames || '[]')[0] || '未分配'
    console.log(`  ${s.order}. ${s.title}`)
    console.log(`     负责人: ${assignee} | 状态: ${s.status}`)
  }
}

main().finally(() => p.$disconnect())
