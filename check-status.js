const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const steps = await p.taskStep.findMany({
    where: { taskId: 'cmlqa7pmm000ji9tgrz5qyd7a' },
    orderBy: { order: 'asc' },
    include: {
      assignee: { select: { name: true } }
    }
  })
  
  console.log('=== 任务步骤状态 ===\n')
  for (const step of steps) {
    const statusIcon = {
      'pending': '⏸️',
      'in_progress': '🔵',
      'waiting_approval': '🟡',
      'done': '✅'
    }[step.status] || '❓'
    
    console.log(`${step.order}. ${step.title}`)
    console.log(`   状态: ${statusIcon} ${step.status}`)
    console.log(`   Agent: ${step.agentStatus || '-'}`)
    console.log(`   负责人: ${step.assignee?.name || '未分配'}`)
    console.log('')
  }
}

main().finally(() => p.$disconnect())
