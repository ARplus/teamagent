// 诊断: 任务 cmms2hj3h0001v7ik4u1hgug1 的所有步骤状态
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const taskId = 'cmms2hj3h0001v7ik4u1hgug1'
  const steps = await prisma.taskStep.findMany({
    where: { taskId },
    orderBy: { order: 'asc' },
    select: {
      id: true, order: true, title: true, status: true, agentStatus: true,
      stepType: true, parallelGroup: true, requiresApproval: true,
      assigneeId: true, approvedAt: true, completedAt: true
    }
  })
  console.log(`\n=== 任务 ${taskId} 的步骤（共 ${steps.length} 个）===\n`)
  for (const s of steps) {
    console.log(`[order=${s.order}] ${s.stepType || 'task'} | status=${s.status} | agentStatus=${s.agentStatus}`)
    console.log(`  ID: ${s.id}`)
    console.log(`  标题: ${s.title}`)
    console.log(`  parallelGroup=${s.parallelGroup} requiresApproval=${s.requiresApproval}`)
    console.log(`  approvedAt=${s.approvedAt} completedAt=${s.completedAt}`)
    console.log()
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
