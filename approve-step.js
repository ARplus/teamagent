const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const stepId = 'cmls3ues7000dv7uys3pxbei7'
  
  // 查看当前状态
  const step = await prisma.taskStep.findUnique({ where: { id: stepId } })
  console.log('当前步骤状态:', step.status)
  console.log('提交结果:', step.result)
  
  // 批准步骤
  const updated = await prisma.taskStep.update({
    where: { id: stepId },
    data: {
      status: 'done',
      agentStatus: 'done',
      approvedAt: new Date(),
    }
  })
  
  console.log('\n✅ 已批准！新状态:', updated.status)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
